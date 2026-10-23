require "./spec_helper"
require "file_utils"
require "json"

# Real end-to-end test of the git plumbing: create a mirror-ish bare repo with
# a commit, list/read/commit/conflict, using only the module under test.
describe MdEditor::Git do
  repo_id = 9999_i64

  before_all do
    Dir.mkdir_p("/tmp/md_editor_spec/repos")
    # Build a normal repo with one commit, then clone --mirror it, like the server would.
    src = "/tmp/md_editor_spec/src_repo"
    dest = "/tmp/md_editor_spec/repos/9999.git"
    FileUtils.rm_rf(src)
    FileUtils.rm_rf(dest)
    Process.run("git", ["init", "-b", "main", src], env: {"GIT_AUTHOR_NAME" => "t", "GIT_AUTHOR_EMAIL" => "t@t", "GIT_COMMITTER_NAME" => "t", "GIT_COMMITTER_EMAIL" => "t@t"})
    File.write("#{src}/hello.md", "+++\ntitle = \"Hello\"\n+++\n\n# Hello\n\nBody text.\n")
    File.write("#{src}/README.md", "readme\n")
    Process.run("git", ["add", "."], chdir: src)
    Process.run("git", ["commit", "-m", "init"], chdir: src, env: {"GIT_AUTHOR_NAME" => "t", "GIT_AUTHOR_EMAIL" => "t@t", "GIT_COMMITTER_NAME" => "t", "GIT_COMMITTER_EMAIL" => "t@t"})
    Process.run("git", ["clone", "--mirror", src, dest])

    # Point the module's paths at our temp dir.
    MdEditor::Git.override_repos_dir_for_tests("/tmp/md_editor_spec/repos")
  end

  after_all do
    FileUtils.rm_rf("/tmp/md_editor_spec")
  end

  it "lists and reads markdown" do
    files = MdEditor::Git.list_markdown(repo_id, "main")
    files.map(&.[1]).should contain("hello.md")
    content = MdEditor::Git.read_file(repo_id, "main", "hello.md")
    content.should contain("Body text.")
  end

  it "parses zola front matter" do
    parsed = MdEditor::Posts.parse(MdEditor::Git.read_file(repo_id, "main", "hello.md"))
    parsed.title.should eq("Hello")
    parsed.valid_front_matter.should be_true
    parsed.body.should eq("# Hello\n\nBody text.\n")
    json = MdEditor::Posts.parsed_json(parsed)
    JSON.parse(json)["front_matter"]["title"].as_s.should eq("Hello")
  end

  it "runs the full save/conflict lifecycle" do
    # 1. create new file on a fresh branch (base_blob nil) → new blob
    blob0 = MdEditor::Git.commit_file(repo_id, "spec-user", "main", "new.md",
      "v1", nil, "add new", "Spec", "spec@test")
    blob0.size.should eq(40)
    MdEditor::Git.branch_exists?(repo_id, "spec-user").should be_true

    # 2. update with correct base_blob → succeeds
    blob1 = MdEditor::Git.commit_file(repo_id, "spec-user", "spec-user", "new.md",
      "v2", blob0, "update", "Spec", "spec@test")
    blob1.should_not eq(blob0)

    # 3. stale base_blob → Conflict
    expect_raises(MdEditor::Git::Conflict) do
      MdEditor::Git.commit_file(repo_id, "spec-user", "spec-user", "new.md",
        "v4", blob0, "stale base", "Spec", "spec@test")
    end

    # 4. create with base_blob nil on an existing file → Conflict
    expect_raises(MdEditor::Git::Conflict) do
      MdEditor::Git.commit_file(repo_id, "spec-user", "spec-user", "new.md",
        "clash", nil, "should fail", "Spec", "spec@test")
    end

    # latest content is what step 2 wrote
    MdEditor::Git.read_file(repo_id, "spec-user", "new.md").should eq("v2")

    # per-path log: newest first, has both commits
    log = MdEditor::Git.log_path(repo_id, "spec-user", "new.md")
    log.size.should be >= 2
    log.first["subject"].as(String).should eq("update")

    # diff between the two commits shows the change (log gives commit shas, newest first)
    diff = MdEditor::Git.diff(repo_id, "#{log[1]["sha"].as(String)}..#{log[0]["sha"].as(String)}", "new.md")
    diff.should contain("-v1")
    diff.should contain("+v2")
  end
end
