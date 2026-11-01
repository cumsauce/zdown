require "json"
require "toml"

require "yaml"

# Zola-aware parsing: front matter split-out, title extraction, shortcode
# detection, and the page/section fields the site browser sorts and badges by.
module MdEditor
  module Posts
    extend self

    record Parsed, front_matter : Hash(String, TOML::Any)?, body : String, title : String?,
      shortcodes : Array(String), valid_front_matter : Bool do
      def to_json(json : JSON::Builder)
        json.object do
          json.field("title", title)
          json.field("valid_front_matter", valid_front_matter)
          json.field("shortcodes", shortcodes)
          fm = front_matter.try &.to_h
          json.field("front_matter") do
            json.object do
              front_matter.try &.each do |k, v|
                json.field(k) do
                  JSON.parse(v.to_json_value).to_json(json)
                end
              end
            end
          end
          json.field("body", body)
        end
      end
    end

    # Zola shortcodes appear in two shapes:
    #   {{ name(arg="v") }}                inline
    #   {% name(arg="v") %} … {% end %}    block
    # Only the opening form names a shortcode, so `end` is never collected.
    INLINE_SHORTCODE = /\{\{\s*([A-Za-z_]\w*)\s*(?:\(|\}\})/
    BLOCK_SHORTCODE  = /\{%\s*([A-Za-z_]\w*)\s*(?:\(|%\})/
    NON_SHORTCODES   = %w[end else]

    # What the site browser needs per file. Values are read off the raw lines
    # (dates stay "2026-01-04" as written, not a server-timezone timestamp).
    record Meta, date : String?, updated : String?, draft : Bool, description : String?,
      weight : Int64?, sort_by : String?, transparent : Bool, render : Bool

    # Top-level `key = value` / `key: value` lines, stopping at the first table.
    def top_level_fields(raw : String) : Hash(String, String)
      fields = {} of String => String
      raw.each_line do |line|
        break if line.starts_with?('[')
        if m = line.match(/^\s*"?([A-Za-z_][\w-]*)"?\s*[=:]\s*(.+?)\s*$/)
          fields[m[1]] ||= unquote(m[2])
        end
      end
      fields
    end

    private def unquote(v : String) : String
      if v.size >= 2 && ((v.starts_with?('"') && v.ends_with?('"')) || (v.starts_with?('\'') && v.ends_with?('\'')))
        return v[1...-1].gsub("\\\"", "\"").gsub("\\\\", "\\")
      end
      v.sub(/\s+#.*$/, "")
    end

    # The raw front matter text and which fence it used (+++ TOML, --- YAML).
    def front_matter_text(content : String) : {String, String}?
      {"+++", "---"}.each do |fence|
        next unless content.starts_with?(fence)
        if idx = content.index("\n#{fence}", fence.size)
          return {fence, content[fence.size...idx]}
        end
      end
      nil
    end

    DATED_FILE = /(?:^|\/)(\d{4}-\d{2}-\d{2})[-_][^\/]+$/

    def meta(content : String, path : String) : Meta
      fm = front_matter_text(content)
      f = fm ? top_level_fields(fm[1]) : {} of String => String
      # like Zola: no `date` key, but a date-prefixed filename (or bundle dir)
      from_name = path.sub(/\/index\.(md|markdown)$/i, "").match(DATED_FILE).try(&.[1])
      date = f["date"]?.try { |d| d.match(/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/).try(&.[0]) } || from_name
      Meta.new(date, f["updated"]?, f["draft"]? == "true", f["description"]?,
        f["weight"]?.try(&.to_i64?), f["sort_by"]?, f["transparent"]? == "true", f["render"]? != "false")
    end

    def shortcodes_in(body : String) : Array(String)
      names = [] of String
      body.scan(INLINE_SHORTCODE) { |m| names << m[1] }
      body.scan(BLOCK_SHORTCODE) { |m| names << m[1] }
      names.reject! { |n| NON_SHORTCODES.includes?(n) }
      names.uniq!
      names
    end

    def parse(content : String) : Parsed
      fm = nil
      body = content
      valid = false

      yaml_title = nil
      if text = front_matter_text(content)
        fence, raw = text
        body = content[(fence.size + raw.size + 4)..].lstrip('\r').lstrip('\n')
        if fence == "+++"
          begin
            fm = TOML.parse(raw)
            valid = true
          rescue e : TOML::ParseException
            valid = false
          end
        else
          begin
            valid = !YAML.parse(raw).raw.nil?
          rescue e : YAML::ParseException
            valid = false
          end
          yaml_title = top_level_fields(raw)["title"]? if valid
        end
      end

      title = fm.try(&.dig?("title")).try(&.as_s?) || yaml_title
      title ||= first_heading(body) unless body.empty?

      shortcodes = shortcodes_in(body)

      Parsed.new(fm, body, title, shortcodes, valid)
      # NB: to_json is provided via a helper below; see parsed_json()
    end

    def parsed_json(p : Parsed) : String
      JSON.build do |json|
        json.object do
          json.field("title", p.title)
          json.field("valid_front_matter", p.valid_front_matter)
          json.field("shortcodes", p.shortcodes)
          json.field("front_matter") do
            json.object do
              p.front_matter.try &.each do |k, v|
                json.field(k, scalar(v))
              end
            end
          end
          json.field("body", p.body)
        end
      end
    end

    # Deep-convert TOML::Any to JSON-friendly types.
    def to_json_value(v : TOML::Any) : JSON::Any
      case raw = v.raw
      when String   then JSON::Any.new(raw)
      when Int64    then JSON::Any.new(raw)
      when Float64  then JSON::Any.new(raw)
      when Bool     then JSON::Any.new(raw)
      when Nil      then JSON::Any.new(nil)
      when Time     then JSON::Any.new(raw.to_rfc3339)
      when Array    then JSON::Any.new(raw.map { |e| to_json_value(e) })
      when Hash     then JSON::Any.new(raw.transform_values { |x| to_json_value(x) })
      else               JSON::Any.new(raw.to_s)
      end
    end

    private def first_heading(body : String) : String?
      body.each_line do |line|
        if m = line.match(/^#\s+(.+)/)
          return m[1].strip
        end
      end
      nil
    end

    private def scalar(v : TOML::Any) : String | Int64 | Float64 | Bool | Nil
      case v.raw
      when String then v.as_s
      when Int64  then v.as_i64
      when Float64 then v.as_f
      when Bool   then v.raw.as(Bool)
      else
        v.to_s
      end
    end
  end
end
