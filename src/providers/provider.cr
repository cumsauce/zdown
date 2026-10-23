require "json"
require "http/client"
require "uri"

module MdEditor
  abstract class Provider
    getter id : String

    def initialize(@id : String)
    end

    abstract def authorize_url(state : String) : String
    abstract def exchange_code(code : String) : TokenResponse
    abstract def fetch_user(access_token : String) : UserInfo
    abstract def fetch_repos(access_token : String) : Array(RepoInfo)
    abstract def clone_url(full_name : String) : String

    # Authorization header value for git-over-HTTPS (http.extraHeader).
    def git_auth(access_token : String) : String
      "Bearer #{access_token}"
    end

    # Exchange a refresh token for a new access token. Providers whose tokens
    # don't expire (GitHub OAuth apps) return nil.
    def refresh(refresh_token : String) : TokenResponse?
      nil
    end

    # Human label for login buttons.
    def label : String
      id.capitalize
    end

    record TokenResponse, access_token : String, refresh_token : String?, expires_in : Int64?
    record UserInfo, uid : String, login : String, name : String?, avatar_url : String?
    record RepoInfo, full_name : String, private : Bool, default_branch : String

    @@registered : Hash(String, Provider)?

    def self.registered : Hash(String, Provider)
      @@registered ||= begin
        h = {} of String => Provider
        if cid = MdEditor.config.github_client_id
          h["github"] = GitHub.new(cid, MdEditor.config.github_client_secret.to_s)
        end
        if cid = MdEditor.config.gitlab_client_id
          h["gitlab"] = GitLab.new(cid, MdEditor.config.gitlab_client_secret.to_s, MdEditor.config.gitlab_base_url)
        end
        h
      end
    end

    def self.find(id : String) : Provider?
      registered[id]?
    end

    protected def form_post(url : String, headers : HTTP::Headers, form : Hash(String, String)) : JSON::Any
      body = URI::Params.encode(form)
      resp = HTTP::Client.post(url, headers: headers, body: body)
      raise "token exchange failed: HTTP #{resp.status_code}" unless resp.success?
      JSON.parse(resp.body)
    end

    protected def api_get(url : String, token : String) : JSON::Any
      resp = HTTP::Client.get(url, headers: HTTP::Headers{
        "Authorization" => "Bearer #{token}",
        "Accept"        => "application/json",
        "User-Agent"    => "md_editor",
      })
      raise "provider API failed: HTTP #{resp.status_code} for #{url}" unless resp.success?
      JSON.parse(resp.body)
    end
  end
end
