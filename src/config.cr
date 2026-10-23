require "toml"

module MdEditor
  @@config : Config?

  # Loaded once by `configure` (server bootstrap); nil until then.
  def self.config : Config
    @@config.not_nil!
  end

  def self.configure : Config
    @@config = Config.load
  end

  class Config
    getter host : String
    getter port : Int32
    getter secret_key : String
    getter data_dir : String
    getter public_origin : String
    getter public_dir : String
    # Dev/test only: act as the first seeded user for any request without a
    # session. Never enable this for a real deployment.
    getter dev_auto_login : Bool
    getter github_client_id : String?
    getter github_client_secret : String?
    getter gitlab_client_id : String?
    getter gitlab_client_secret : String?

    def initialize(
      @host : String,
      @port : Int32,
      @secret_key : String,
      @data_dir : String,
      @public_origin : String,
      @public_dir : String,
      @dev_auto_login : Bool,
      @github_client_id : String?,
      @github_client_secret : String?,
      @gitlab_client_id : String?,
      @gitlab_client_secret : String?,
    )
    end

    def self.load(path : String = ENV["MD_EDITOR_CONFIG"]? || "config.toml") : Config
      unless File.exists?(path)
        raise "config file not found: #{path} (copy config.example.toml)"
      end
      t = TOML.parse_file(path)

      secret = t.dig?("server", "secret_key").try(&.as_s?) || raise "server.secret_key missing in #{path}"
      if secret.empty? || secret == "CHANGE_ME"
        raise "server.secret_key must be a real secret (openssl rand -hex 32)"
      end

      new(
        host: t.dig?("server", "host").try(&.as_s?) || "127.0.0.1",
        port: t.dig?("server", "port").try(&.as_i) || 3000,
        secret_key: secret,
        data_dir: t.dig?("server", "data_dir").try(&.as_s?) || "./data",
        public_origin: t.dig?("server", "public_origin").try(&.as_s?) || "http://localhost:5175",
        public_dir: t.dig?("server", "public_dir").try(&.as_s?) || default_public_dir,
        dev_auto_login: t.dig?("server", "dev_auto_login").try(&.as_bool?) || false,
        github_client_id: t.dig?("providers", "github", "client_id").try(&.as_s?),
        github_client_secret: t.dig?("providers", "github", "client_secret").try(&.as_s?),
        gitlab_client_id: t.dig?("providers", "gitlab", "client_id").try(&.as_s?),
        gitlab_client_secret: t.dig?("providers", "gitlab", "client_secret").try(&.as_s?),
      )
    end

    # Built-frontend location when server.public_dir isn't set. Candidates,
    # first hit wins: ./public (repo root / container WORKDIR), then next to
    # the binary, then ../public from the binary (bin/md_editor layouts).
    private def self.default_public_dir : String
      exe = Process.executable_path rescue nil
      candidates = ["./public"]
      if exe
        exe_dir = File.dirname(exe)
        candidates << File.join(exe_dir, "public")
        candidates << File.expand_path("../public", exe_dir)
      end
      candidates.find { |c| Dir.exists?(c) } || "./public"
    end

    def db_path : String
      File.join(data_dir, "app.db")
    end

    def repos_dir : String
      File.join(data_dir, "repos")
    end
  end
end
