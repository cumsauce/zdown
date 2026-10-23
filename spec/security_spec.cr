require "./spec_helper"

describe MdEditor::Security do
  it "round-trips provider tokens through encrypt/decrypt" do
    tok = "gho_abcDEF123"
    MdEditor::Security.decrypt(MdEditor::Security.encrypt(tok)).should eq tok
  end
end
