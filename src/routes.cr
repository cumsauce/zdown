require "json"

module MdEditor
  # Raised anywhere in a route; converted to a JSON response by error
  # handlers registered in server.cr.
  class ApiError < Exception
    getter status : Int32

    def initialize(@status : Int32, message : String)
      super(message)
    end
  end

  module Routes
    extend self

    def setup
      setup_auth
      setup_repos
      setup_posts
    end

    # ---------- helpers ----------

    private def current_user_id(env) : Int64?
      token = env.request.cookies[Security::SESSION_COOKIE]?.try(&.value)
      return nil unless token
      Security.verify_session(token)
    end

    private def require_user(env) : Int64
      current_user_id(env) || dev_auto_user_id || raise ApiError.new(401, "not signed in")
    end

    # Dev/test convenience (server.dev_auto_login): any browser is treated as
    # the first seeded user. Refuses when no user exists rather than guessing.
    private def dev_auto_user_id : Int64?
      return nil unless MdEditor.config.dev_auto_login
      MdEditor.db.query_one?("SELECT id FROM users ORDER BY id LIMIT 1", as: {Int64})
    end

    private def json_response(env, status : Int32, body : String)
      env.response.status_code = status
      env.response.headers["Content-Type"] = "application/json"
      body
    end

    # Build a JSON document with JSON::Builder, then hand it to json_response.
    # (A block-forwarding overload can't infer its parameter arity here.)
    private def json_build(env, status : Int32, &block : JSON::Builder ->)
      json_response(env, status, String.build { |io| JSON.build(io, &block) })
    end

    private def body_json(env) : JSON::Any
      raw = env.request.body.try(&.gets_to_end)
      raise ApiError.new(400, "expected JSON body") if raw.nil? || raw.empty?
      JSON.parse(raw)
    rescue e : JSON::ParseException
      raise ApiError.new(400, "invalid JSON")
    end

    private def user_token(uid : Int64, provider : String) : String
      row = MdEditor.db.query_one?(
        "SELECT access_token_enc FROM users WHERE id = ? AND provider = ?", uid, provider,
        as: {String})
      raise ApiError.new(401, "no provider token; re-login") unless row
      Security.decrypt(row) || raise ApiError.new(500, "stored token undecryptable (secret changed?)")
    end

    private def user_branch(repo) : String
      "#{repo[:full_name].split('/')[-1]}-user"
    end

    private def repo_owned(env, uid : Int64)
      repo_id = env.params.url["repo_id"].to_i64?
      raise ApiError.new(400, "bad repo id") unless repo_id
      row = MdEditor.db.query_one?(
        "SELECT id, provider, full_name, default_branch FROM repos WHERE id = ? AND user_id = ?",
        repo_id, uid, as: {Int64, String, String, String})
      raise ApiError.new(404, "repo not found") unless row
      {id: row[0], provider: row[1], full_name: row[2], default_branch: row[3]}
    end

    private def provider_for(repo)
      Provider.find(repo[:provider]) ||
        raise ApiError.new(500, "provider #{repo[:provider]} not configured")
    end

    # Remote URL of a repo. Local-only repos have none yet: sync/publish
    # refuse until the repo is connected to a provider repo.
    private def remote_url(repo) : String
      raise ApiError.new(409, "repo is local; connect it to a repository to sync or publish") if local?(repo)
      provider_for(repo).clone_url(repo[:full_name])
    end

    private def local?(repo) : Bool
      repo[:provider] == "local"
    end

    # Provider HTTP calls raise plain exceptions; surface them as 502s.
    private def with_provider_api(&block)
      yield
    rescue e : ApiError
      raise e
    rescue e
      raise ApiError.new(502, "provider API failed: #{e.message}")
    end

    # ---------- auth ----------

    private def setup_auth
      get "/api/auth/:provider/start" do |env|
        provider = Provider.find(env.params.url["provider"])
        raise ApiError.new(404, "unknown provider") unless provider
        state = Random::Secure.hex(16)
        env.response.cookies << HTTP::Cookie.new("md_oauth_state", state, http_only: true,
          samesite: :lax, max_age: 10.minutes, path: "/")
        env.redirect provider.authorize_url(state)
      end

      get "/api/auth/:provider/callback" do |env|
        provider = Provider.find(env.params.url["provider"])
        raise ApiError.new(404, "unknown provider") unless provider

        state_cookie = env.request.cookies["md_oauth_state"]?
        raise ApiError.new(400, "missing state cookie") unless state_cookie
        raise ApiError.new(400, "state mismatch") if state_cookie.value != env.params.query["state"]?

        code = env.params.query["code"]?
        raise ApiError.new(400, "missing code") unless code

        token = with_provider_api { provider.exchange_code(code) }
        user = with_provider_api { provider.fetch_user(token.access_token) }

        existing = MdEditor.db.query_one?(
          "SELECT id FROM users WHERE provider = ? AND provider_uid = ?",
          provider.id, user.uid, as: {Int64})

        uid : Int64
        if ex = existing
          MdEditor.db.exec(
            "UPDATE users SET access_token_enc = ?, login = ?, name = ?, avatar_url = ? WHERE id = ?",
            Security.encrypt(token.access_token), user.login, user.name, user.avatar_url, ex)
          uid = ex
        else
          uid = MdEditor.db.scalar(
            "INSERT INTO users (provider, provider_uid, login, name, avatar_url, access_token_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
            provider.id, user.uid, user.login, user.name, user.avatar_url,
            Security.encrypt(token.access_token), Time.utc.to_unix).as(Int64)
        end

        env.response.cookies << HTTP::Cookie.new(Security::SESSION_COOKIE, Security.sign_session(uid),
          http_only: true, samesite: :lax, max_age: Security::SESSION_TTL, path: "/")
        env.response.cookies.delete("md_oauth_state")
        env.redirect "#{MdEditor.config.public_origin}/"
      end

      post "/api/auth/logout" do |env|
        env.response.cookies.delete(Security::SESSION_COOKIE)
        json_response(env, 200, %({"ok":true}))
      end

      get "/api/me" do |env|
        uid = require_user(env)
        user = MdEditor.db.query_one?(
          "SELECT id, provider, login, name, avatar_url FROM users WHERE id = ?",
          uid, as: {Int64, String, String, String?, String?})
        raise ApiError.new(404, "user gone") unless user
        json_response(env, 200, {
          id:         user[0],
          provider:   user[1],
          login:      user[2],
          name:       user[3],
          avatar_url: user[4],
        }.to_json)
      end
    end

    # ---------- repos ----------

    private def setup_repos
      get "/api/repos" do |env|
        uid = require_user(env)
        rows = MdEditor.db.query_all(
          "SELECT id, provider, full_name, default_branch FROM repos WHERE user_id = ? ORDER BY created_at DESC",
          uid, as: {Int64, String, String, String})
        json_response(env, 200, rows.map { |r| {
          id: r[0], provider: r[1], full_name: r[2], default_branch: r[3],
        } }.to_json)
      end

      # Available repos from the provider that aren't imported yet.
      get "/api/repos/available" do |env|
        uid = require_user(env)
        provider_id = env.params.query["provider"]? ||
                      MdEditor.db.query_one("SELECT provider FROM users WHERE id = ?", uid, as: String)
        provider = Provider.find(provider_id) ||
                   raise ApiError.new(400, "provider not configured")
        token = user_token(uid, provider_id)

        imported = Set.new(MdEditor.db.query_all(
          "SELECT full_name FROM repos WHERE user_id = ? AND provider = ?", uid, provider_id, as: String))

        list = with_provider_api { provider.fetch_repos(token) }
          .select { |r| !imported.includes?(r.full_name) }
          .map { |r| {full_name: r.full_name, private: r.private, default_branch: r.default_branch} }
        json_response(env, 200, list.to_json)
      end

      post "/api/repos" do |env|
        uid = require_user(env)
        body = body_json(env)
        provider_id = body["provider"]?.try(&.as_s?)
        full_name = body["full_name"]?.try(&.as_s?)

        # No provider → a local scratch repo: just files in a bare repo we own.
        # No clone; an initial commit gives the editor a tree to work from.
        unless provider_id
          raise ApiError.new(400, "full_name required") unless full_name
          raise ApiError.new(400, "bad name") unless full_name.matches?(/^[\w.-]+$/)

          login, name = MdEditor.db.query_one("SELECT login, name FROM users WHERE id = ?",
            uid, as: {String, String?})
          author = name.presence || login

          if MdEditor.db.query_one?("SELECT 1 FROM repos WHERE user_id = ? AND provider = 'local' AND full_name = ?",
              uid, full_name, as: {Int32})
            raise ApiError.new(409, "you already have a scratchpad named #{full_name}")
          end

          repo_id = MdEditor.db.scalar(
            "INSERT INTO repos (user_id, provider, full_name, default_branch, created_at) VALUES (?, 'local', ?, 'main', ?) RETURNING id",
            uid, full_name, Time.utc.to_unix).as(Int64)

          begin
            Git.init_bare(repo_id, "main", author, "#{login}@local")
          rescue e : Git::Error
            MdEditor.db.exec("DELETE FROM repos WHERE id = ?", repo_id)
            Git.delete_mirror(repo_id)
            raise ApiError.new(500, "git init failed: #{e.message}")
          end

          # json_response returns the body string; `next <value>` exits the
          # block with it so the import path below never runs.
          next json_response(env, 201, {id: repo_id, provider: "local", full_name: full_name,
                                   default_branch: "main"}.to_json)
        end

        full_name ||= ""
        raise ApiError.new(400, "bad full_name") unless full_name.matches?(/^[\w.-]+\/[\w.-]+$/)

        provider = Provider.find(provider_id.not_nil!) ||
                   raise ApiError.new(400, "provider not configured")
        token = user_token(uid, provider_id.not_nil!)

        repo_meta = with_provider_api { provider.fetch_repos(token) }.find { |r| r.full_name == full_name }
        default_branch = repo_meta.try(&.default_branch) || "main"

        repo_id = MdEditor.db.scalar(
          "INSERT INTO repos (user_id, provider, full_name, default_branch, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
          uid, provider_id, full_name, default_branch, Time.utc.to_unix).as(Int64)

        begin
          Git.mirror_clone(provider.clone_url(full_name), Git.mirror_path(repo_id), token)
        rescue e : Git::Error
          # roll back the row; no orphaned repo entries
          MdEditor.db.exec("DELETE FROM repos WHERE id = ?", repo_id)
          raise ApiError.new(502, "git clone failed: #{e.message}")
        end

        json_response(env, 201, {id: repo_id, provider: provider_id, full_name: full_name,
                                 default_branch: default_branch}.to_json)
      end

      post "/api/repos/:repo_id/sync" do |env|
        uid = require_user(env)
        repo = repo_owned(env, uid)
        url = remote_url(repo)
        token = user_token(uid, repo[:provider])

        Git.fetch_mirror(repo[:id], url, token)
        json_response(env, 200, {ok: true, head: Git.default_branch(repo[:id])}.to_json)
      rescue e : Git::Error
        raise ApiError.new(502, "fetch failed: #{e.message}")
      end

      delete "/api/repos/:repo_id" do |env|
        uid = require_user(env)
        repo = repo_owned(env, uid)
        MdEditor.db.exec("DELETE FROM post_cache WHERE repo_id = ?", repo[:id])
        MdEditor.db.exec("DELETE FROM repos WHERE id = ?", repo[:id])
        Git.delete_mirror(repo[:id])
        json_response(env, 200, %({"ok":true}))
      end
    end

    # ---------- posts ----------

    private def setup_posts
      get "/api/repos/:repo_id/posts" do |env|
        uid = require_user(env)
        repo = repo_owned(env, uid)
        unless local?(repo)
          provider = provider_for(repo)
          token = user_token(uid, repo[:provider])
          Git.fetch_mirror(repo[:id], provider.clone_url(repo[:full_name]), token)
        end

        ref = Git.working_ref(repo[:id], user_branch(repo))
        files = Git.list_markdown(repo[:id], ref)

        posts = files.map do |blob, path|
          parsed = Posts.parse(Git.read_file(repo[:id], ref, path))
          {
            path:               path,
            title:              parsed.title,
            blob:               blob,
            shortcodes:         parsed.shortcodes,
            valid_front_matter: parsed.valid_front_matter,
          }
        end

        json_response(env, 200, posts.to_json)
      rescue e : Git::Error
        raise ApiError.new(502, "git failed: #{e.message}")
      end

      get "/api/repos/:repo_id/post" do |env|
        uid = require_user(env)
        repo = repo_owned(env, uid)
        path = env.params.query["path"]?
        raise ApiError.new(400, "path required") unless path

        ref = Git.working_ref(repo[:id], user_branch(repo))
        content = Git.read_file(repo[:id], ref, path)
        blob = Git.file_blob(repo[:id], ref, path)
        parsed = Posts.parse(content)

        # Write the document with JSON::Builder directly (no re-serialization).
        json_build(env, 200) do |json|
          json.object do
            json.field("path", path)
            json.field("blob", blob)
            json.field("head_ref", ref)
            # Raw file text (front matter included) so the client can round-trip
            # without re-serializing TOML.
            json.field("content", content)
            json.field("title", parsed.title)
            json.field("valid_front_matter", parsed.valid_front_matter)
            json.field("shortcodes", parsed.shortcodes)
            json.field("front_matter") do
              json.object do
                parsed.front_matter.try &.each do |k, v|
                  json.field(k) do
                    # TOML scalars serialize fine; TOML::Any delegates to raw
                    Posts.to_json_value(v).to_json(json)
                  end
                end
              end
            end
            json.field("body", parsed.body)
          end
        end
      rescue e : Git::Error
        raise ApiError.new(404, "post not found: #{e.message}")
      end

      post "/api/repos/:repo_id/post/content" do |env|
        uid = require_user(env)
        repo = repo_owned(env, uid)
        body = body_json(env)
        path = body["path"]?.try(&.as_s?)
        content = body["content"]?.try(&.as_s?)
        base_blob = body["base_blob"]?.try(&.as_s?)
        message = body["message"]?.try(&.as_s?)
        raise ApiError.new(400, "path and content required") unless path && content

        login, name = MdEditor.db.query_one("SELECT login, name FROM users WHERE id = ?",
          uid, as: {String, String?})
        author = name.presence || login
        commit_msg = message.presence || (base_blob ? "Update #{path}" : "Create #{path}")

        branch = user_branch(repo)
        base_ref = Git.working_ref(repo[:id], branch)

        author_email = local?(repo) ? "#{login}@local" : "#{login}@users.noreply.#{repo[:provider]}.com"
        blob = Git.commit_file(repo[:id], branch, base_ref, path, content,
          base_blob, commit_msg, author, author_email)

        json_response(env, 200, {ok: true, blob: blob, branch: branch}.to_json)
      rescue e : Git::Conflict
        raise ApiError.new(409, "conflict: #{e.message}")
      rescue e : Git::Error
        raise ApiError.new(502, "git failed: #{e.message}")
      end

      get "/api/repos/:repo_id/post/versions" do |env|
        uid = require_user(env)
        repo = repo_owned(env, uid)
        path = env.params.query["path"]?
        raise ApiError.new(400, "path required") unless path

        ref = Git.working_ref(repo[:id], user_branch(repo))
        json_response(env, 200, Git.log_path(repo[:id], ref, path).to_json)
      end

      get "/api/repos/:repo_id/diff" do |env|
        uid = require_user(env)
        repo = repo_owned(env, uid)
        range = env.params.query["range"]?
        path = env.params.query["path"]?
        raise ApiError.new(400, "range required") unless range
        # A range is two revs (shas or branch names) with `..` or `...`, or a
        # single rev. `..` is needed when the left side isn't a commit (the
        # empty tree, for diffing a root commit).
        raise ApiError.new(400, "bad range") unless range.matches?(/^[A-Za-z0-9][\w.\/-]*(?:\.{2,3}[A-Za-z0-9][\w.\/-]*)?$/)
        json_response(env, 200, {diff: Git.diff(repo[:id], range, path)}.to_json)
      rescue e : Git::Error
        raise ApiError.new(400, "git diff failed: #{e.message}")
      end

      get "/api/repos/:repo_id/post/content_at" do |env|
        uid = require_user(env)
        repo = repo_owned(env, uid)
        sha = env.params.query["sha"]?
        path = env.params.query["path"]?
        raise ApiError.new(400, "sha and path required") unless sha && path
        raise ApiError.new(400, "bad sha") unless sha.matches?(/^[0-9a-f]{7,40}$/)
        json_response(env, 200, {content: Git.content_at(repo[:id], sha, path)}.to_json)
      rescue e : Git::Error
        raise ApiError.new(404, "not found: #{e.message}")
      end

      post "/api/repos/:repo_id/publish" do |env|
        uid = require_user(env)
        repo = repo_owned(env, uid)
        url = remote_url(repo)
        token = user_token(uid, repo[:provider])

        branch = user_branch(repo)
        raise ApiError.new(400, "nothing to publish") unless Git.branch_exists?(repo[:id], branch)

        head = Git.run_head_sha(repo[:id], branch)
        Git.push_mirror(repo[:id], url, "#{branch}:refs/heads/#{repo[:default_branch]}", token)
        json_response(env, 200, {ok: true, pushed: head}.to_json)
      rescue e : Git::Error
        raise ApiError.new(409, "push rejected (remote moved?): #{e.message}")
      end

      # Connect a local repo to a provider repo: stores the remote, then pushes
      # the local history (working branch + main) so the remote matches what
      # was written here. After this, sync/publish work like any imported repo.
      post "/api/repos/:repo_id/connect" do |env|
        uid = require_user(env)
        repo = repo_owned(env, uid)
        raise ApiError.new(409, "repo already has a remote") unless local?(repo)

        body = body_json(env)
        provider_id = body["provider"]?.try(&.as_s?) ||
                      MdEditor.db.query_one("SELECT provider FROM users WHERE id = ?", uid, as: String)
        full_name = body["full_name"]?.try(&.as_s?)
        raise ApiError.new(400, "full_name required") unless full_name
        raise ApiError.new(400, "bad full_name") unless full_name.matches?(/^[\w.-]+\/[\w.-]+$/)
        raise ApiError.new(409, "already imported as #{full_name}") if MdEditor.db.query_one?(
          "SELECT 1 FROM repos WHERE user_id = ? AND provider = ? AND full_name = ?",
          uid, provider_id, full_name, as: {Int32})

        provider = Provider.find(provider_id) ||
                   raise ApiError.new(400, "provider not configured")
        token = user_token(uid, provider_id)

        # Remote must be empty (or nonexistent) — we never overwrite content.
        begin
          refs = Git.ls_remote_heads(repo[:id], provider.clone_url(full_name), token)
          raise ApiError.new(409, "remote not empty (#{refs.join(", ")})") unless refs.empty?
        rescue e : Git::Error
          raise ApiError.new(502, "remote unreachable: #{e.message}")
        end

        branch = user_branch(repo)
        main = repo[:default_branch]

        Git.set_remote(repo[:id], provider.clone_url(full_name))
        head = Git.branch_exists?(repo[:id], branch) ? Git.run_head_sha(repo[:id], branch) : nil
        push_from = head ? branch : main
        pushed = Git.run_head_sha(repo[:id], push_from)
        begin
          Git.push_mirror(repo[:id], provider.clone_url(full_name), "#{push_from}:refs/heads/#{main}", token)
        rescue e : Git::Error
          raise ApiError.new(409, "push rejected: #{e.message}")
        end

        MdEditor.db.exec(
          "UPDATE repos SET provider = ?, full_name = ?, default_branch = ? WHERE id = ?",
          provider_id, full_name, main, repo[:id])

        json_response(env, 200, {ok: true, provider: provider_id, full_name: full_name, pushed: pushed}.to_json)
      rescue e : Git::Error
        raise ApiError.new(502, "git failed: #{e.message}")
      end
    end
  end
end
