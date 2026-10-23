require "json"

module MdEditor
  class GitHub < Provider
    API      = "https://api.github.com"
    AUTHORIZE = "https://github.com/login/oauth/authorize"
    TOKEN     = "https://github.com/login/oauth/access_token"

    def initialize(@client_id : String, @client_secret : String)
      super("github")
    end

    def authorize_url(state : String) : String
      params = URI::Params.build do |form|
        form.add "client_id", @client_id
        form.add "redirect_uri", "#{MdEditor.config.public_origin}/api/auth/github/callback"
        form.add "scope", "repo read:user"
        form.add "state", state
      end
      "#{AUTHORIZE}?#{params}"
    end

    def exchange_code(code : String) : TokenResponse
      json = form_post(TOKEN, HTTP::Headers{
        "Accept"       => "application/json",
        "Content-Type" => "application/x-www-form-urlencoded",
      }, {
        "client_id"     => @client_id,
        "client_secret" => @client_secret,
        "code"          => code,
      })
      TokenResponse.new(
        access_token: json["access_token"].as_s,
        refresh_token: nil,
        expires_in: nil
      )
    end

    def fetch_user(access_token : String) : UserInfo
      u = api_get("#{API}/user", access_token)
      UserInfo.new(
        uid: u["id"].to_s,
        login: u["login"].as_s,
        name: u["name"]?.try(&.as_s?),
        avatar_url: u["avatar_url"]?.try(&.as_s?),
      )
    end

    def fetch_repos(access_token : String) : Array(RepoInfo)
      # pagination: follow Link header pages, hard cap at 30 pages
      result = [] of RepoInfo
      url : String? = "#{API}/user/repos?per_page=100&sort=pushed"
      headers = HTTP::Headers{
        "Authorization" => "Bearer #{access_token}",
        "Accept"        => "application/vnd.github+json",
        "User-Agent"    => "md_editor",
      }
      30.times do
        break if url.nil?
        resp = HTTP::Client.get(url.not_nil!, headers: headers)
        raise "GitHub repos API failed: HTTP #{resp.status_code}" unless resp.success?
        JSON.parse(resp.body).as_a.each do |r|
          result << RepoInfo.new(
            full_name: r["full_name"].as_s,
            private: r["private"].as_bool,
            default_branch: r["default_branch"]?.try(&.as_s?) || "main",
          )
        end
        url = next_link(resp.headers["Link"]?)
      end
      result
    end

    def clone_url(full_name : String) : String
      "https://github.com/#{full_name}.git"
    end

    # RFC 5988 Link header → rel="next" URL
    private def next_link(link : String?) : String?
      return nil if link.nil? || link.empty?
      link.split(',').each do |part|
        segs = part.split(';')
        url_seg = segs.find!(&.includes?("<")).strip
        rel_seg = segs.find(&.includes?("rel="))
        next unless rel_seg
        if rel_seg.includes?(%("next"))
          return url_seg[1...-1]
        end
      end
      nil
    end
  end

  class GitLab < Provider
    API       = "https://gitlab.com/api/v4"
    AUTHORIZE = "https://gitlab.com/oauth/authorize"
    TOKEN     = "https://gitlab.com/oauth/token"

    def initialize(@client_id : String, @client_secret : String)
      super("gitlab")
    end

    def authorize_url(state : String) : String
      params = URI::Params.build do |form|
        form.add "client_id", @client_id
        form.add "redirect_uri", "#{MdEditor.config.public_origin}/api/auth/gitlab/callback"
        form.add "response_type", "code"
        form.add "scope", "api read_user write_repository"
        form.add "state", state
      end
      "#{AUTHORIZE}?#{params}"
    end

    def exchange_code(code : String) : TokenResponse
      json = form_post(TOKEN, HTTP::Headers{
        "Content-Type" => "application/x-www-form-urlencoded",
      }, {
        "client_id"     => @client_id,
        "client_secret" => @client_secret,
        "code"          => code,
        "grant_type"    => "authorization_code",
        "redirect_uri"  => "#{MdEditor.config.public_origin}/api/auth/gitlab/callback",
      })
      TokenResponse.new(
        access_token: json["access_token"].as_s,
        refresh_token: json["refresh_token"]?.try(&.as_s?),
        expires_in: json["expires_in"]?.try(&.as_i64),
      )
    end

    def fetch_user(access_token : String) : UserInfo
      u = api_get("#{API}/user", access_token)
      UserInfo.new(
        uid: u["id"].to_s,
        login: u["username"].as_s,
        name: u["name"]?.try(&.as_s?),
        avatar_url: u["avatar_url"]?.try(&.as_s?),
      )
    end

    def fetch_repos(access_token : String) : Array(RepoInfo)
      page = 1
      result = [] of RepoInfo
      loop do
        json = api_get("#{API}/projects?membership=true&per_page=100&page=#{page}&order_by=last_activity_at", access_token)
        arr = json.as_a
        break if arr.empty?
        arr.each do |r|
          next unless r["empty_repo"]?.try(&.as_bool?) == false
          result << RepoInfo.new(
            full_name: r["path_with_namespace"].as_s,
            private: r["visibility"]?.try(&.as_s?) == "private",
            default_branch: r["default_branch"]?.try(&.as_s?) || "main",
          )
        end
        page += 1
        break if page > 30
      end
      result
    end

    def clone_url(full_name : String) : String
      "https://gitlab.com/#{full_name}.git"
    end
  end
end
