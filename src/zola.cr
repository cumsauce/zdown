require "json"
require "toml"

# What the editor needs to know about a site, computed once per commit:
# every post's metadata, the site config, shortcode templates and image paths.
# Listing is the hot path (every navigation), so the snapshot is cached against
# the ref's commit; a new commit (save, sync) invalidates it naturally.
module MdEditor
  module Zola
    extend self

    record Snapshot, head : String, posts_json : String, site_json : String

    @@cache = {} of Int64 => Snapshot

    def snapshot(repo_id : Int64, ref : String) : Snapshot
      head = Git.head_sha(repo_id, ref)
      cached = @@cache[repo_id]?
      return cached if cached && cached.head == head
      snap = build(repo_id, ref, head)
      @@cache[repo_id] = snap
      snap
    end

    private def build(repo_id : Int64, ref : String, head : String) : Snapshot
      tree = Git.list_tree(repo_id, ref)
      paths = tree.map(&.[1])
      root = site_root(paths)
      config_text = root ? config_of(repo_id, ref, root, paths) : nil
      config = config_text ? parse_config(config_text) : nil

      md = tree.select { |(_, p)| Git.markdown?(p) }
      contents = Git.read_many(repo_id, ref, md.map(&.[1]))
      times = Git.last_modified(repo_id, ref)

      posts_json = JSON.build do |json|
        json.array do
          md.each do |blob, path|
            content = contents[path]? || ""
            parsed = Posts.parse(content)
            meta = Posts.meta(content, path)
            json.object do
              json.field("path", path)
              json.field("title", parsed.title)
              json.field("blob", blob)
              json.field("shortcodes", parsed.shortcodes)
              json.field("valid_front_matter", parsed.valid_front_matter)
              json.field("date", meta.date)
              json.field("updated", meta.updated)
              json.field("draft", meta.draft)
              json.field("description", meta.description)
              json.field("weight", meta.weight)
              json.field("sort_by", meta.sort_by)
              json.field("transparent", meta.transparent)
              json.field("render", meta.render)
              json.field("modified", times[path]?)
            end
          end
        end
      end

      Snapshot.new(head, posts_json, site_json(repo_id, ref, root, config, paths))
    end

    # The directory holding the site config: the repo root, or (monorepos) the
    # shallowest folder with both a config and a content/ directory.
    def site_root(paths : Array(String)) : String?
      configs = paths.select { |p| p.ends_with?("config.toml") || p.ends_with?("zola.toml") }
        .reject { |p| p.includes?("themes/") || p.includes?("node_modules/") }
        .sort_by { |p| p.count('/') }
      configs.each do |c|
        dir = c.includes?('/') ? c[0..c.rindex('/').not_nil!] : ""
        next unless File.basename(c).in?("config.toml", "zola.toml")
        return dir if paths.any?(&.starts_with?("#{dir}content/"))
      end
      nil
    end

    private def config_of(repo_id, ref, root : String, paths) : String?
      name = {"zola.toml", "config.toml"}.find { |n| paths.includes?("#{root}#{n}") }
      name ? Git.read_many(repo_id, ref, ["#{root}#{name}"])["#{root}#{name}"]? : nil
    end

    private def parse_config(text : String) : Hash(String, TOML::Any)?
      TOML.parse(text)
    rescue TOML::ParseException
      nil
    end

    SHORTCODE_FILE = /templates\/shortcodes\/(.+)\.(html|md)$/
    # Zola >= 0.23: `{% component name(…) %}…{% endcomponent name %}`, in any template.
    COMPONENT_DEF  = /\{%-?\s*component\s+([\w.]+)\s*\(.*?\{%-?\s*endcomponent\b[^%]*%\}/m

    private def site_json(repo_id, ref, root : String?, config, paths) : String
      theme = config.try(&.["theme"]?).try(&.as_s?)

      # Same precedence as Zola: the site's own template shadows the theme's.
      templates = {} of String => {String, String}
      if root
        dirs = ["#{root}templates/shortcodes/"]
        dirs.unshift("#{root}themes/#{theme}/templates/shortcodes/") if theme
        dirs.each do |dir|
          paths.select(&.starts_with?(dir)).each do |p|
            if m = p.match(SHORTCODE_FILE)
              templates[m[1]] = {p, m[2]}
            end
          end
        end
      end
      sources = Git.read_many(repo_id, ref, templates.values.map(&.[0]))
      images = paths.select { |p| Git.image?(p) && !p.starts_with?("#{root}public/") }.first(4000)

      components = {} of String => {String, String}
      if root
        dirs = ["#{root}templates/"]
        dirs.unshift("#{root}themes/#{theme}/templates/") if theme
        dirs.each do |dir|
          files = paths.select { |p| p.starts_with?(dir) && p.matches?(/\.(html|md|xml|txt|jinja2?|tera)$/) }
          contents = Git.read_many(repo_id, ref, files)
          files.each do |p|
            (contents[p]? || "").scan(COMPONENT_DEF) { |m| components[m[1]] = {p, m[0]} }
          end
        end
      end

      JSON.build do |json|
        json.object do
          json.field("zola", !root.nil?)
          json.field("root", root || "")
          json.field("title", config.try(&.["title"]?).try(&.as_s?))
          json.field("base_url", config.try(&.["base_url"]?).try(&.as_s?))
          json.field("description", config.try(&.["description"]?).try(&.as_s?))
          json.field("theme", theme)
          json.field("extra") { Posts.to_json_value(TOML::Any.new(config.try(&.["extra"]?).try(&.raw) || ({} of String => TOML::Any))).to_json(json) }
          json.field("images", images)
          json.field("components") do
            json.array do
              components.each do |name, (path, source)|
                json.object do
                  json.field("name", name)
                  json.field("path", path)
                  json.field("source", source)
                end
              end
            end
          end
          json.field("shortcodes") do
            json.array do
              templates.each do |name, (path, ext)|
                json.object do
                  json.field("name", name)
                  json.field("path", path)
                  json.field("kind", ext)
                  json.field("source", sources[path]? || "")
                end
              end
            end
          end
        end
      end
    end
  end
end
