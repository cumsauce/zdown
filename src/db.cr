require "db"
require "sqlite3"
require "json"

module MdEditor
  class_getter db : DB::Database?

  def self.init_db : DB::Database
    Dir.mkdir_p(File.dirname(MdEditor.config.db_path))
    database = DB.open "sqlite3://#{MdEditor.config.db_path}?journal_mode=wal&synchronous=normal"
    database.exec <<-SQL
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        provider_uid TEXT NOT NULL,
        login TEXT NOT NULL,
        name TEXT,
        avatar_url TEXT,
        access_token_enc TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(provider, provider_uid)
      );
      SQL
    database.exec <<-SQL
      CREATE TABLE IF NOT EXISTS repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        provider TEXT NOT NULL,
        full_name TEXT NOT NULL,
        default_branch TEXT NOT NULL DEFAULT 'main',
        created_at INTEGER NOT NULL,
        UNIQUE(user_id, provider, full_name)
      );
      SQL
    database.exec <<-SQL
      CREATE TABLE IF NOT EXISTS post_cache (
        repo_id INTEGER NOT NULL REFERENCES repos(id),
        path TEXT NOT NULL,
        title TEXT,
        front_matter TEXT NOT NULL DEFAULT '{}',
        last_commit TEXT,
        updated_at INTEGER,
        PRIMARY KEY (repo_id, path)
      );
      SQL
    # additive migrations (SQLite has no ADD COLUMN IF NOT EXISTS)
    user_cols = database.query_all("SELECT name FROM pragma_table_info('users')", as: String)
    {"refresh_token_enc" => "TEXT", "token_expires_at" => "INTEGER"}.each do |col, type|
      database.exec("ALTER TABLE users ADD COLUMN #{col} #{type}") unless user_cols.includes?(col)
    end
    @@db = database
    database
  end

  def self.db : DB::Database
    @@db.not_nil!
  end
end
