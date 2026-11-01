require "./spec_helper"
require "file_utils"
require "json"

SYNC_ROOT = "/tmp/md_editor_sync_spec"
SYNC_ENV  = {"GIT_AUTHOR_NAME" => "t", "GIT_AUTHOR_EMAIL" => "t@t", "GIT_COMMITTER_NAME" => "t", "GIT_COMMITTER_EMAIL" => "t@t"}

private def sh(dir, *args)
  st = Process.run("git", args.to_a, chdir: dir, env: SYNC_ENV, error: Process::Redirect::Close, output: Process::Redirect::Close)
  raise "git #{args} failed" unless st.success?
end

# A site whose default branch moves independently of the working branch, the
# way a laptop pushing to GitHub does while the mirror holds unpublished work.
private def fresh_site(id : Int64) : String
  src = "#{SYNC_ROOT}/src#{id}"
  dest = "#{SYNC_ROOT}/repos/#{id}.git"
  FileUtils.rm_rf(src)
  FileUtils.rm_rf(dest)
  Dir.mkdir_p("#{src}/content/blog")
  File.write("#{src}/config.toml", %(base_url = "https://x.org"\ntitle = "X"\n))
  File.write("#{src}/content/blog/keep.md", "+++\ntitle = \"Keep\"\ndate = 2024-01-02\n+++\n\none\ntwo\nthree\n")
  File.write("#{src}/content/blog/gone.md", "+++\ntitle = \"Gone\"\n+++\n\nbye\n")
  sh(src, "init", "-q", "-b", "main")
  sh(src, "add", ".")
  sh(src, "commit", "-qm", "init")
  sh(SYNC_ROOT, "clone", "-q", "--mirror", src, dest)
  src
end

# Publish a commit from "elsewhere", then fetch it, as /sync does.
private def remote_change(id : Int64, src : String, msg = "remote")
  yield
  sh(src, "add", "-A")
  sh(src, "commit", "-qm", msg)
  sh("#{SYNC_ROOT}/repos/#{id}.git", "fetch", "-q", src, "+refs/heads/main:refs/heads/main")
end

private def save(id : Int64, branch : String, path : String, content : String, autosave = false)
  blob = MdEditor::Git.file_blob(id, MdEditor::Git.working_ref(id, branch), path)
  MdEditor::Git.commit_file(id, branch, MdEditor::Git.working_ref(id, branch), path, content, blob,
    "Update #{path}", "t", "t@t", autosave_of: autosave ? "main" : nil)
end

private def titles(id : Int64, ref : String)
  MdEditor::Git.list_markdown(id, ref).map(&.[1])
end

describe "syncing the working branch with the remote" do
  before_all do
    FileUtils.rm_rf(SYNC_ROOT)
    Dir.mkdir_p("#{SYNC_ROOT}/repos")
    MdEditor::Git.override_repos_dir_for_tests("#{SYNC_ROOT}/repos")
  end
  after_all { FileUtils.rm_rf(SYNC_ROOT) }

  it "fast-forwards a stale branch, so articles removed upstream disappear" do
    id = 101_i64
    src = fresh_site(id)
    save(id, "site-user", "content/blog/keep.md", "+++\ntitle = \"Keep\"\n+++\n\nedited\n")
    MdEditor::Git.advance_default(id, "main", MdEditor::Git.run_head_sha(id, "site-user")) # "published"
    sh(src, "pull", "-q", "#{SYNC_ROOT}/repos/#{id}.git", "main")
    remote_change(id, src) { File.delete("#{src}/content/blog/gone.md") }

    titles(id, "site-user").should contain("content/blog/gone.md") # the old bug
    r = MdEditor::Git.integrate(id, "site-user", "main", "t", "t@t")
    r.state.should eq("fast_forwarded")
    titles(id, "site-user").should_not contain("content/blog/gone.md")
  end

  it "merges when both sides moved but don't overlap, keeping unpublished work" do
    id = 102_i64
    src = fresh_site(id)
    save(id, "site-user", "content/blog/mine.md", "+++\ntitle = \"Mine\"\n+++\n\nnew\n")
    remote_change(id, src) { File.delete("#{src}/content/blog/gone.md") }

    r = MdEditor::Git.integrate(id, "site-user", "main", "t", "t@t")
    r.state.should eq("merged")
    list = titles(id, "site-user")
    list.should contain("content/blog/mine.md")
    list.should_not contain("content/blog/gone.md")
    MdEditor::Git.integrate(id, "site-user", "main", "t", "t@t").state.should eq("up_to_date")
  end

  it "reports a real conflict without moving anything, then honours the chosen side" do
    id = 103_i64
    src = fresh_site(id)
    save(id, "site-user", "content/blog/keep.md", "+++\ntitle = \"Keep\"\n+++\n\nmine\n")
    remote_change(id, src) { File.write("#{src}/content/blog/keep.md", "+++\ntitle = \"Keep\"\n+++\n\ntheirs\n") }
    before = MdEditor::Git.run_head_sha(id, "site-user")

    r = MdEditor::Git.integrate(id, "site-user", "main", "t", "t@t")
    r.state.should eq("conflict")
    r.conflicts.should eq(["content/blog/keep.md"])
    MdEditor::Git.run_head_sha(id, "site-user").should eq(before)

    MdEditor::Git.integrate(id, "site-user", "main", "t", "t@t", "theirs").state.should eq("merged")
    MdEditor::Git.read_file(id, "site-user", "content/blog/keep.md").should contain("theirs")
    MdEditor::Git.read_file(id, "site-user", "content/blog/keep.md").should_not contain("<<<<")
    # the branch now contains main, so a publish fast-forwards
    MdEditor::Git.unpublished(id, "site-user", "main")[0].should be > 0
  end

  it "keeps mine when asked, including a file deleted upstream" do
    id = 104_i64
    src = fresh_site(id)
    save(id, "site-user", "content/blog/gone.md", "+++\ntitle = \"Gone\"\n+++\n\nstill here\n")
    remote_change(id, src) { File.delete("#{src}/content/blog/gone.md") }

    MdEditor::Git.integrate(id, "site-user", "main", "t", "t@t").state.should eq("conflict")
    MdEditor::Git.integrate(id, "site-user", "main", "t", "t@t", "mine").state.should eq("merged")
    MdEditor::Git.read_file(id, "site-user", "content/blog/gone.md").should contain("still here")
  end

  it "lists what publish would send" do
    id = 105_i64
    fresh_site(id)
    MdEditor::Git.unpublished(id, "site-user", "main").should eq({0, [] of MdEditor::Git::Changed})
    save(id, "site-user", "content/blog/a.md", "+++\ntitle = \"A\"\n+++\n")
    ahead, changed = MdEditor::Git.unpublished(id, "site-user", "main")
    ahead.should eq(1)
    changed.map(&.path).should eq(["content/blog/a.md"])
    changed.first.status.should eq("A")
  end

  it "folds a run of autosaves into one version, but never a published commit" do
    id = 106_i64
    fresh_site(id)
    path = "content/blog/keep.md"
    save(id, "site-user", path, "first", autosave: true)
    first = MdEditor::Git.run_head_sha(id, "site-user")
    save(id, "site-user", path, "second", autosave: true)
    save(id, "site-user", path, "third", autosave: true)
    MdEditor::Git.log_path(id, "site-user", path).size.should eq(2) # init + one version
    MdEditor::Git.read_file(id, "site-user", path).should eq("third")

    MdEditor::Git.advance_default(id, "main", MdEditor::Git.run_head_sha(id, "site-user"))
    save(id, "site-user", path, "fourth", autosave: true)
    MdEditor::Git.log_path(id, "site-user", path).size.should eq(3)
    first.should_not eq(MdEditor::Git.run_head_sha(id, "site-user"))
  end

  it "commits uploads without overwriting, and renames bundles with their images" do
    id = 107_i64
    src = fresh_site(id)
    remote_change(id, src) do
      Dir.mkdir_p("#{src}/content/blog/trip")
      File.write("#{src}/content/blog/trip/index.md", "+++\ntitle = \"Trip\"\n+++\n\n![](a.png)\n")
      File.write("#{src}/content/blog/trip/a.png", "PNG")
    end
    png = Bytes[0x89, 0x50, 0x00, 0xff]
    MdEditor::Git.commit_asset(id, "site-user", "main", "static/i.png", png, "add", "t", "t@t").should eq("static/i.png")
    MdEditor::Git.commit_asset(id, "site-user", "main", "static/i.png", png, "add", "t", "t@t").should eq("static/i-2.png")
    MdEditor::Git.read_blob(id, "site-user", "static/i.png").should eq(png)

    blob = MdEditor::Git.file_blob(id, "site-user", "content/blog/trip/index.md").not_nil!
    MdEditor::Git.move_file(id, "site-user", "main", "content/blog/trip/index.md", "content/blog/journey/index.md", blob, "mv", "t", "t@t")
    tree = MdEditor::Git.list_tree(id, "site-user").map(&.[1])
    tree.should contain("content/blog/journey/index.md")
    tree.should contain("content/blog/journey/a.png")
    tree.should_not contain("content/blog/trip/a.png")
    expect_raises(MdEditor::Git::Conflict) do
      MdEditor::Git.move_file(id, "site-user", "main", "content/blog/keep.md", "content/blog/gone.md",
        MdEditor::Git.file_blob(id, "site-user", "content/blog/keep.md").not_nil!, "mv", "t", "t@t")
    end
  end
end

describe MdEditor::Posts do
  it "reads the fields the site browser sorts by, as written" do
    m = MdEditor::Posts.meta("+++\ntitle = \"x\"\ndate = 2026-01-04\ndraft = true\ndescription = \"a \\\"b\\\"\"\nweight = 3\n\n[extra]\ndate = 1999-01-01\n+++\nbody", "content/a.md")
    m.date.should eq("2026-01-04")
    m.draft.should be_true
    m.description.should eq(%(a "b"))
    m.weight.should eq(3)
  end

  it "takes the date from a dated filename or bundle folder like Zola" do
    MdEditor::Posts.meta("+++\n+++\n", "content/blog/2023-05-01-hello.md").date.should eq("2023-05-01")
    MdEditor::Posts.meta("+++\n+++\n", "content/blog/2023-05-01_hello/index.md").date.should eq("2023-05-01")
  end

  it "understands YAML front matter" do
    p = MdEditor::Posts.parse("---\ntitle: Hello YAML\ndate: 2024-02-03\n---\n\nbody\n")
    p.title.should eq("Hello YAML")
    p.valid_front_matter.should be_true
    p.body.should eq("body\n")
    MdEditor::Posts.meta("---\ntitle: Hello\ndate: 2024-02-03\ndraft: true\n---\n", "a.md").draft.should be_true
  end
end

describe MdEditor::Zola do
  it "finds Tera components in any template, with dotted names" do
    src = %({% component note(kind: string = "info") %}\n<aside>{{ body }}</aside>\n{% endcomponent note %}\n<p>x</p>\n{% component ui.card(t) %}{{ t }}{% endcomponent ui.card %})
    names = [] of String
    src.scan(MdEditor::Zola::COMPONENT_DEF) { |m| names << m[1] }
    names.should eq(["note", "ui.card"])
  end

  it "finds the site root, including a monorepo subfolder, and ignores themes" do
    MdEditor::Zola.site_root(["config.toml", "content/_index.md"]).should eq("")
    MdEditor::Zola.site_root(["web/config.toml", "web/content/_index.md", "README.md"]).should eq("web/")
    MdEditor::Zola.site_root(["themes/t/config.toml", "themes/t/content/a.md"]).should be_nil
    MdEditor::Zola.site_root(["README.md", "notes.md"]).should be_nil
  end
end
