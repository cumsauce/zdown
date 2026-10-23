require "openssl"
require "openssl/hmac"
require "random/secure"

# Session tokens (HMAC-signed) and provider token encryption (AES-256-GCM),
# both keyed off server.secret_key.
module MdEditor
  module Security
    extend self

    SESSION_COOKIE  = "md_editor_session"
    SESSION_TTL     = 30.days
    KEY_DERIVE_INFO = "md_editor:v1"

    def session_secret : Bytes
      OpenSSL::HMAC.digest(OpenSSL::Algorithm::SHA256, MdEditor.config.secret_key, KEY_DERIVE_INFO + ":session")
    end

    def token_enc_key : Bytes
      OpenSSL::HMAC.digest(OpenSSL::Algorithm::SHA256, MdEditor.config.secret_key, KEY_DERIVE_INFO + ":enc")
    end

    # Signed, url-safe token: "<user_id>.<expires_unix>.<hmac>"
    def sign_session(user_id : Int64) : String
      exp = Time.utc.to_unix + SESSION_TTL.total_seconds.to_i64
      payload = "#{user_id}.#{exp}"
      sig = OpenSSL::HMAC.hexdigest(OpenSSL::Algorithm::SHA256, session_secret, payload)
      "#{payload}.#{sig}"
    end

    def verify_session(token : String) : Int64?
      parts = token.split('.')
      return nil unless parts.size == 3
      payload = "#{parts[0]}.#{parts[1]}"
      sig = OpenSSL::HMAC.hexdigest(OpenSSL::Algorithm::SHA256, session_secret, payload)
      return nil unless secure_compare(sig, parts[2])
      exp = parts[1].to_i64?
      return nil if exp.nil? || exp < Time.utc.to_unix
      parts[0].to_i64?
    rescue
      nil
    end

    # AES-256-GCM. Output: hex(iv || tag || ciphertext).
    def encrypt(plain : String) : String
      cipher = OpenSSL::Cipher.new("aes-256-gcm")
      cipher.encrypt
      cipher.key = token_enc_key
      iv = Random::Secure.random_bytes(12)
      cipher.iv = iv
      ct = cipher.update(plain) + cipher.final
      tag = cipher.gcm_tag
      (iv + tag + ct).hexstring
    end

    def decrypt(encoded : String) : String?
      raw = encoded.hexbytes
      return nil if raw.size < 29
      iv = raw[0, 12]
      tag = raw[12, 16]
      ct = raw[28..]
      cipher = OpenSSL::Cipher.new("aes-256-gcm")
      cipher.decrypt
      cipher.key = token_enc_key
      cipher.iv = iv
      cipher.gcm_tag = tag
      (cipher.update(ct) + cipher.final).to_s
    rescue
      nil
    end

    private def secure_compare(a : String, b : String) : Bool
      return false unless a.bytesize == b.bytesize
      diff = 0
      a.bytes.each_with_index do |x, i|
        diff |= x ^ b.bytes[i]
      end
      diff == 0
    end
  end
end
