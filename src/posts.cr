require "json"
require "toml"

# Zola-aware parsing: front matter split-out, title extraction, shortcode
# detection (detection + highlighting in M1; rendering in M2).
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

      if content.starts_with?("+++")
        if idx = content.index("\n+++")
          raw_toml = content[3...idx]
          body = content[(idx + 4)..].lstrip('\n')
          begin
            fm = TOML.parse(raw_toml)
            valid = true
          rescue e : TOML::ParseException
            valid = false
          end
        end
      end

      title = fm.try(&.dig?("title")).try(&.as_s?)
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
