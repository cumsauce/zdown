# Dev-only seed for the local UI harness.
#
# Creates (or reuses) a fake user + imported repo in the database configured by
# MD_EDITOR_CONFIG, mirrors the repo from its git origin, and prints a signed
# session token for that user. Never point this at a real database.
#
#   MD_EDITOR_CONFIG=/tmp/md_ui/config.toml crystal run scripts/seed_dev.cr -- test/zola-site
require "../src/md_editor"

MdEditor.configure
MdEditor.init_db

full_name = ARGV[0]? || "test/zola-site"
uid_minus = MdEditor.db.query_one?(
  "SELECT id FROM users WHERE provider = 'github' AND provider_uid = 'dev-user-1'", as: Int64)

uid = if existing = uid_minus
        existing
      else
        MdEditor.db.scalar(
          "INSERT INTO users (provider, provider_uid, login, name, avatar_url, access_token_enc, created_at)
           VALUES ('github', 'dev-user-1', 'lume', 'lume', NULL, ?, ?) RETURNING id",
          MdEditor::Security.encrypt("dev-token"), Time.utc.to_unix).as(Int64)
      end

repo_id = MdEditor.db.query_one?(
  "SELECT id FROM repos WHERE user_id = ? AND provider = 'github' AND full_name = ?",
  uid, full_name, as: Int64)

repo_id = if existing = repo_id
            existing
          else
            MdEditor.db.scalar(
              "INSERT INTO repos (user_id, provider, full_name, default_branch, created_at)
               VALUES (?, 'github', ?, 'main', ?) RETURNING id",
              uid, full_name, Time.utc.to_unix).as(Int64)
          end

dest = MdEditor::Git.mirror_path(repo_id)
unless Dir.exists?(dest)
  MdEditor::Git.mirror_clone("https://github.com/#{full_name}.git", dest, "dev-token")
end

puts "user=#{uid} repo=#{repo_id} mirror=#{dest}"
puts "session=#{MdEditor::Security.sign_session(uid)}"
