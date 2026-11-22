// backlogs-vault: encrypts the body of Markdown docs (the frontmatter stays readable) with a
// Secure Enclave key; decrypting asks for Touch ID (or the Mac password).
//
//   backlogs-vault lock FILE...            encrypts files not locked yet (no prompt)
//   backlogs-vault unlock REASON FILE...   one Touch ID prompt, then decrypts the locked files
//
// Format: frontmatter, a notice, then `<!-- backlogs-vault v1 BASE64 -->`, BASE64 being the
// ephemeral P-256 public key (65 bytes, x9.63) followed by the AES-GCM box (nonce, text, tag).
// The AES key comes from ECDH between that ephemeral key and the Secure Enclave key, through HKDF.
import CryptoKit
import Foundation
import LocalAuthentication

let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Backlogs/vault")
let keyFile = dir.appendingPathComponent("key")
let publicFile = dir.appendingPathComponent("key.pub")
let marker = "<!-- backlogs-vault v1 "
let notice = "🔒 Encrypted content. To read it: the padlock button in Backlogs, then Touch ID."

func fail(_ message: String) -> Never {
	FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
	exit(1)
}

func publicKey() throws -> P256.KeyAgreement.PublicKey {
	if let data = try? Data(contentsOf: publicFile) { return try .init(x963Representation: data) }
	guard SecureEnclave.isAvailable else { fail("No Secure Enclave on this Mac") }
	var error: Unmanaged<CFError>?
	guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .userPresence], &error) else { throw error!.takeRetainedValue() }
	let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
	try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
	try key.dataRepresentation.write(to: keyFile, options: .atomic)
	try key.publicKey.x963Representation.write(to: publicFile, options: .atomic)
	return key.publicKey
}

func symmetric(_ secret: SharedSecret, _ ephemeral: Data, _ recipient: Data) -> SymmetricKey {
	secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: ephemeral + recipient, sharedInfo: Data("backlogs-vault v1".utf8), outputByteCount: 32)
}

// Splits a doc into its frontmatter (with both `---` lines) and its body.
func split(_ text: String) -> (String, String) {
	guard text.hasPrefix("---\n"), let end = text.range(of: "\n---\n", range: text.index(text.startIndex, offsetBy: 3)..<text.endIndex) else { return ("", text) }
	return (String(text[..<end.upperBound]), String(text[end.upperBound...]))
}

func payload(_ body: String) -> Data? {
	guard let start = body.range(of: marker), let end = body.range(of: " -->", range: start.upperBound..<body.endIndex) else { return nil }
	return Data(base64Encoded: String(body[start.upperBound..<end.lowerBound]))
}

func lock(_ path: String, _ recipient: P256.KeyAgreement.PublicKey) throws {
	let url = URL(fileURLWithPath: path)
	let (head, body) = split(try String(contentsOf: url, encoding: .utf8))
	if payload(body) != nil { return }
	let ephemeral = P256.KeyAgreement.PrivateKey()
	let key = symmetric(try ephemeral.sharedSecretFromKeyAgreement(with: recipient), ephemeral.publicKey.x963Representation, recipient.x963Representation)
	let box = try AES.GCM.seal(Data(body.utf8), using: key)
	let data = ephemeral.publicKey.x963Representation + box.combined!
	try (head + "\n" + notice + "\n\n" + marker + data.base64EncodedString() + " -->\n").write(to: url, atomically: true, encoding: .utf8)
}

func unlock(_ path: String, _ key: SecureEnclave.P256.KeyAgreement.PrivateKey) throws {
	let url = URL(fileURLWithPath: path)
	let (head, body) = split(try String(contentsOf: url, encoding: .utf8))
	guard let data = payload(body), data.count > 65 else { return }
	let ephemeral = try P256.KeyAgreement.PublicKey(x963Representation: data.prefix(65))
	let secret = try key.sharedSecretFromKeyAgreement(with: ephemeral)
	let plain = try AES.GCM.open(.init(combined: data.dropFirst(65)), using: symmetric(secret, data.prefix(65), key.publicKey.x963Representation))
	try (head + String(decoding: plain, as: UTF8.self)).write(to: url, atomically: true, encoding: .utf8)
}

func authenticate(_ reason: String) -> LAContext {
	let context = LAContext()
	let done = DispatchSemaphore(value: 0)
	var ok = false
	context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
		ok = success
		done.signal()
	}
	done.wait()
	if !ok { fail("Authentication cancelled") }
	return context
}

let args = Array(CommandLine.arguments.dropFirst())
do {
	switch args.first {
	case "lock":
		let recipient = try publicKey()
		for path in args.dropFirst() { try lock(path, recipient) }
	case "unlock" where args.count >= 2:
		let files = Array(args.dropFirst(2))
		guard let data = try? Data(contentsOf: keyFile) else { fail("No vault key") }
		let context = authenticate(args[1])
		let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: data, authenticationContext: context)
		for path in files { try unlock(path, key) }
	default:
		fail("Usage: backlogs-vault lock FILE... | unlock REASON FILE...")
	}
} catch {
	fail("\(error)")
}
