require "json"
require "base64"

module MdEditor
  # gitlab.com or a self-hosted instance (providers.gitlab.base_url).
  # GitLab OAuth access tokens expire after ~2h; the refresh token is stored
  # and used transparently by Routes#user_token.
  class GitLab < Provider
    getter base_url : String

    def initialize(@client_id : String, @client_secret : String, base_url : String)
      super("gitlab")
      @base_url = base_url.rchop("/")
    end

    def label : String
      "GitLab"
    end

    private def api : String
      "#{@base_url}/api/v4"
    end

    private def redirect_uri : String
      "#{MdEditor.config.public_origin}/api/auth/gitlab/callback"
    end

    def authorize_url(state : String) : String
      params = URI::Params.build do |form|
        form.add "client_id", @client_id
        form.add "redirect_uri", redirect_uri
        form.add "response_type", "code"
        form.add "scope", "api read_user write_repository"
        form.add "state", state
      end
      "#{@base_url}/oauth/authorize?#{params}"
    end

    def exchange_code(code : String) : TokenResponse
      token_request({
        "code"         => code,
        "grant_type"   => "authorization_code",
        "redirect_uri" => redirect_uri,
      })
    end

    def refresh(refresh_token : String) : TokenResponse?
      token_request({
        "refresh_token" => refresh_token,
        "grant_type"    => "refresh_token",
        "redirect_uri"  => redirect_uri,
      })
    end

    private def token_request(form : Hash(String, String)) : TokenResponse
      json = form_post("#{@base_url}/oauth/token", HTTP::Headers{
        "Content-Type" => "application/x-www-form-urlencoded",
        "Accept"       => "application/json",
      }, form.merge({"client_id" => @client_id, "client_secret" => @client_secret}))
      TokenResponse.new(
        access_token: json["access_token"].as_s,
        refresh_token: json["refresh_token"]?.try(&.as_s?),
        expires_in: json["expires_in"]?.try(&.as_i64?),
      )
    end

    def fetch_user(access_token : String) : UserInfo
      u = api_get("#{api}/user", access_token)
      UserInfo.new(
        uid: u["id"].to_s,
        login: u["username"].as_s,
        name: u["name"]?.try(&.as_s?),
        avatar_url: u["avatar_url"]?.try(&.as_s?),
      )
    end

    def fetch_repos(access_token : String) : Array(RepoInfo)
      result = [] of RepoInfo
      (1..30).each do |page|
        arr = api_get("#{api}/projects?membership=true&min_access_level=30&per_page=100&page=#{page}&order_by=last_activity_at", access_token).as_a
        break if arr.empty?
        arr.each do |r|
          next if r["empty_repo"]?.try(&.as_bool?) == true
          result << RepoInfo.new(
            full_name: r["path_with_namespace"].as_s,
            private: r["visibility"]?.try(&.as_s?) != "public",
            default_branch: r["default_branch"]?.try(&.as_s?) || "main",
          )
        end
      end
      result
    end

    def clone_url(full_name : String) : String
      "#{@base_url}/#{full_name}.git"
    end

    # GitLab's git HTTP endpoint takes OAuth tokens as basic auth, user "oauth2".
    def git_auth(access_token : String) : String
      "Basic #{Base64.strict_encode("oauth2:#{access_token}")}"
    end
  end
end
