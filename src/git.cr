require "process"
require "file_utils"

# All git access goes through the system git CLI against per-repo bare mirrors.
# Auth tokens travel via http.extraHeader (never in URLs, never in process args
# that end up in remote-side logs — header value is passed via env below where
# possible; see run() note).
module MdEditor
  module Git
    class Error < Exception
      getter stderr : String

      def initialize(@stderr : String, message : String? = nil)
        super(message || "git failed: #{stderr.lines.first?}")
      end
    end

    extend self

    def mirror_path(repo_id : Int64) : String
      File.join(repos_dir, "#{repo_id}.git")
    end

    # Test hook: point the module at a temp dir.
    @@repos_dir_override : String? = nil

    def self.override_repos_dir_for_tests(dir : String)
      @@repos_dir_override = dir
    end

    private def repos_dir : String
      @@repos_dir_override || MdEditor.config.repos_dir
    end

    # clone --mirror requires a URL; token goes in an extra header.
    def mirror_clone(url : String, dest : String, token : String) : Nil
      Dir.mkdir_p(File.dirname(dest))
      run(["clone", "--mirror", url, dest], token: token)
    end

    # Create an empty bare repo with an initial (root) commit on `branch` so
    # local scratch repos have a tree to diff and branch from. The root commit
    # carries a README, giving local repos a first version to restore to.
    def init_bare(repo_id : Int64, branch : String, author_name : String,
                  author_email : String) : Nil
      dest = mirror_path(repo_id)
      Dir.mkdir_p(File.dirname(dest))
      run(["init", "--bare", "--quiet", "--initial-branch=#{branch}", dest])
      cwd = dest
      tree = run(["mktree"], cwd: cwd, stdin: "").strip
      readme = write_blob(cwd, "+++\ntitle = \"Notes\"\n+++\n\nJust start writing.\n")
      tree = build_tree(cwd, tree, "README.md", readme)
      commit = run(["commit-tree", tree, "-m", "init"], cwd: cwd, env: {
        "GIT_AUTHOR_NAME"     => author_name,
        "GIT_AUTHOR_EMAIL"    => author_email,
        "GIT_COMMITTER_NAME"  => author_name,
        "GIT_COMMITTER_EMAIL" => author_email,
      }).strip
      run(["update-ref", "refs/heads/#{branch}", commit], cwd: cwd)
      run(["symbolic-ref", "HEAD", "refs/heads/#{branch}"], cwd: cwd)
    end

    def fetch_mirror(repo_id : Int64, url : String, token : String) : Nil
      run(["fetch", "--prune", url, "+refs/*:refs/*"], cwd: mirror_path(repo_id), token: token)
    end

    def push_mirror(repo_id : Int64, url : String, refspec : String, token : String) : Nil
      run(["push", url, refspec], cwd: mirror_path(repo_id), token: token)
    end

    # Attach a remote to a previously local-only repo (no-op when it already
    # exists, so connect can be retried).
    def set_remote(repo_id : Int64, url : String) : Nil
      run(["remote", "add", "origin", url], cwd: mirror_path(repo_id))
    rescue Error
      run(["remote", "set-url", "origin", url], cwd: mirror_path(repo_id))
    end

    # Branch heads of a remote, before cloning/pushing to it. Empty for a
    # brand-new (never pushed) repo.
    def ls_remote_heads(repo_id : Int64, url : String, token : String) : Array(String)
      run(["ls-remote", "--heads", url], cwd: mirror_path(repo_id), token: token)
        .lines.compact_map { |l| l.split('\t')[1]?.try(&.sub("refs/heads/", "")) }
    end

    # Default branch of a mirror (where HEAD points).
    def default_branch(repo_id : Int64) : String
      out = run(["symbolic-ref", "--short", "HEAD"], cwd: mirror_path(repo_id)).strip
      out.empty? ? "main" : out
    end

    # Ref to read from: user's working branch if it exists, else the default branch.
    def working_ref(repo_id : Int64, user_branch : String) : String
      if branch_exists?(repo_id, user_branch)
        user_branch
      else
        default_branch(repo_id)
      end
    end

    def branch_exists?(repo_id : Int64, branch : String) : Bool
      status = run_status(["rev-parse", "--verify", "--quiet", "refs/heads/#{branch}"], cwd: mirror_path(repo_id))
      status == 0
    end

    # Markdown files at ref, with blob ids for cheap change detection.
    def list_markdown(repo_id : Int64, ref : String) : Array({String, String})
      out = run(["ls-tree", "-r", "--format=%(objectname) %(path)", ref], cwd: mirror_path(repo_id))
      out.lines.compact_map do |line|
        sha, path = line.split(' ', 2)
        next unless path && path.ends_with?(".md")
        {sha, path}
      end
    end

    def read_file(repo_id : Int64, ref : String, path : String) : String
      run(["show", "#{ref}:#{path}"], cwd: mirror_path(repo_id))
    end

    def file_blob(repo_id : Int64, ref : String, path : String) : String?
      status = run_status(["rev-parse", "--verify", "--quiet", "#{ref}:#{path}"], cwd: mirror_path(repo_id))
      return nil unless status == 0
      run(["rev-parse", "--verify", "#{ref}:#{path}"], cwd: mirror_path(repo_id)).strip
    end

    # Commit a single file's content onto `branch` (created from `base_ref` if new).
    # base_blob is the blob id the client loaded (conflict guard); nil means "file
    # must not exist yet". Returns new blob id. Raises Conflict on mismatch.
    class Conflict < Exception; end

    def commit_file(repo_id : Int64, branch : String, base_ref : String, path : String,
                    content : String, base_blob : String?, message : String,
                    author_name : String, author_email : String) : String
      cwd = mirror_path(repo_id)

      parent = run(["rev-parse", "--verify", "refs/heads/#{branch}"], cwd: cwd).strip rescue nil
      unless parent
        parent = run(["rev-parse", "--verify", base_ref], cwd: cwd).strip
      end

      current = run_status(["rev-parse", "--verify", "--quiet", "#{parent}:#{path}"], cwd: cwd) == 0 ?
        run(["rev-parse", "#{parent}:#{path}"], cwd: cwd).strip : nil

      if base_blob.nil? && !current.nil?
        raise Conflict.new("file already exists (server blob #{current})")
      end
      if base_blob && current != base_blob
        raise Conflict.new("changed on server: expected #{base_blob}, found #{current}")
      end

      blob = write_blob(cwd, content)
      tree = build_tree(cwd, parent, path, blob)
      commit = commit_tree(cwd, tree, parent, message, author_name, author_email)
      # When creating a branch, there is no old value to CAS against.
      if branch_exists?(repo_id, branch)
        update_ref(cwd, "refs/heads/#{branch}", commit, parent)
      else
        run(["update-ref", "refs/heads/#{branch}", commit], cwd: cwd)
      end
      blob
    end

    # Per-path history. Returns array of {sha, author, email, time, subject}.
    def log_path(repo_id : Int64, ref : String, path : String, limit : Int32 = 100) : Array(Hash(String, String | Int64))
      fmt = "%H%x1f%an%x1f%ae%x1f%at%x1f%s"
      out = run(["log", "--format=#{fmt}", "-n#{limit}", ref, "--", path], cwd: mirror_path(repo_id))
      out.lines.compact_map do |line|
        parts = line.split(0x1f.chr)
        next unless parts.size == 5
        {
          "sha"     => parts[0],
          "author"  => parts[1],
          "email"   => parts[2],
          "time"    => parts[3].to_i64,
          "subject" => parts[4],
        } of String => (String | Int64)
      end
    end

    def run_head_sha(repo_id : Int64, branch : String) : String
      run(["rev-parse", "refs/heads/#{branch}"], cwd: mirror_path(repo_id)).strip
    end

    def delete_mirror(repo_id : Int64) : Nil
      path = mirror_path(repo_id)
      FileUtils.rm_rf(path) if File.exists?(path)
    end

    def diff(repo_id : Int64, range : String, path : String? = nil) : String
      args = ["diff", range]
      args.concat(["--", path]) if path
      run(args, cwd: mirror_path(repo_id))
    end

    def content_at(repo_id : Int64, sha : String, path : String) : String
      run(["show", "#{sha}:#{path}"], cwd: mirror_path(repo_id))
    end

    # ---- plumbing helpers (bare-repo writes without a worktree) ----

    private def write_blob(cwd : String, content : String) : String
      run(["hash-object", "-w", "--stdin"], cwd: cwd, stdin: content).strip
    end

    private def build_tree(cwd : String, parent : String, path : String, blob : String) : String
      index = File.tempname("md_editor_index")
      begin
        env = {"GIT_INDEX_FILE" => index}
        parent_tree = run(["rev-parse", "#{parent}^{tree}"], cwd: cwd).strip rescue ""
        if parent_tree.empty?
          run(["mktree"], cwd: cwd, stdin: "", env: env).strip
        else
          run(["read-tree", parent_tree], cwd: cwd, env: env)
          run(["update-index", "--add", "--cacheinfo", "100644,#{blob},#{path}"], cwd: cwd, env: env)
          run(["write-tree"], cwd: cwd, env: env).strip
        end
      ensure
        File.delete(index) if File.exists?(index)
      end
    end

    private def commit_tree(cwd : String, tree : String, parent : String, message : String,
                            author_name : String, author_email : String) : String
      env = {
        "GIT_AUTHOR_NAME"     => author_name,
        "GIT_AUTHOR_EMAIL"    => author_email,
        "GIT_COMMITTER_NAME"  => author_name,
        "GIT_COMMITTER_EMAIL" => author_email,
      }
      run(["commit-tree", tree, "-p", parent, "-m", message], cwd: cwd, env: env).strip
    end

    private def update_ref(cwd : String, ref : String, new : String, old : String) : Nil
      run(["update-ref", ref, new, old], cwd: cwd)
    end

    # ---- process plumbing ----

    private def run(args : Array(String), cwd : String? = nil,
                    stdin : String? = nil, token : String? = nil,
                    env : Hash(String, String)? = nil) : String
      full = Array(String).new
      if token
        full << "-c" << "http.extraHeader=Authorization: Bearer #{token}"
        full << "-c" << "http.lowSpeedLimit=1000" << "-c" << "http.lowSpeedTime=30"
      end
      full << "-c" << "core.askpass="
      full.concat(args)

      sout = IO::Memory.new
      serr = IO::Memory.new
      full_env = {"GIT_TERMINAL_PROMPT" => "0"}
      env.try &.each { |k, v| full_env[k] = v }
      status = Process.run("git", full, env: full_env,
        input: stdin ? IO::Memory.new(stdin) : Process::Redirect::Close,
        output: sout, error: serr, chdir: cwd)
      raise Error.new(serr.to_s) unless status.success?
      sout.to_s
    end

    private def run_status(args : Array(String), cwd : String? = nil) : Int32
      full = ["-c", "core.askpass="] + args
      Process.run("git", full, output: Process::Redirect::Close,
        error: Process::Redirect::Close, chdir: cwd,
        env: {"GIT_TERMINAL_PROMPT" => "0"}).exit_code
    end
  end
end
