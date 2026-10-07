#!/usr/bin/env bash
set -euo pipefail
umask 077
for name in IOS_CERTIFICATE_P12_BASE64 IOS_CERTIFICATE_PASSWORD IOS_PROFILE_BASE64 ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_P8_BASE64; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::Missing GitHub Secret: $name (see mobile/README.md)"
    exit 1
  fi
done
export BREVIA_KEYCHAIN="$RUNNER_TEMP/brevia-signing.keychain-db"
KEYCHAIN_PASSWORD=$(openssl rand -hex 32)
echo "::add-mask::$KEYCHAIN_PASSWORD"
python3 - <<'PY'
import base64, os, pathlib, plistlib, subprocess
root = pathlib.Path(os.environ['RUNNER_TEMP'])
(root / 'brevia-asc.p8').write_bytes(base64.b64decode(os.environ['ASC_KEY_P8_BASE64'], validate=True))
cert = root / 'brevia-distribution.p12'
profile = root / 'brevia.mobileprovision'
cert.write_bytes(base64.b64decode(os.environ['IOS_CERTIFICATE_P12_BASE64'], validate=True))
profile.write_bytes(base64.b64decode(os.environ['IOS_PROFILE_BASE64'], validate=True))
data = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(profile)]))
assert data['Entitlements']['application-identifier'] == '4M64879BBM.com.brevia.breviaMobile', 'Wrong provisioning profile'
assert not data['Entitlements'].get('get-task-allow', True), 'Development profile is not permitted'
assert 'ProvisionedDevices' not in data and not data.get('ProvisionsAllDevices'), 'App Store profile required'
dest = pathlib.Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles'
dest.mkdir(parents=True, exist_ok=True)
installed = dest / (data['UUID'] + '.mobileprovision')
installed.write_bytes(profile.read_bytes())
(root / 'brevia-profile-path').write_text(str(installed))
(root / 'brevia-export.plist').write_bytes(plistlib.dumps({
    'method': 'app-store-connect', 'destination': 'export', 'teamID': '4M64879BBM',
    'signingStyle': 'automatic', 'signingCertificate': 'Apple Distribution',
    'manageAppVersionAndBuildNumber': False,
}))
PY
security create-keychain -p "$KEYCHAIN_PASSWORD" "$BREVIA_KEYCHAIN"
security set-keychain-settings -lut 21600 "$BREVIA_KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$BREVIA_KEYCHAIN"
security import "$RUNNER_TEMP/brevia-distribution.p12" -k "$BREVIA_KEYCHAIN" -P "$IOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$BREVIA_KEYCHAIN" >/dev/null
security list-keychains -d user -s "$BREVIA_KEYCHAIN" "$HOME/Library/Keychains/login.keychain-db"
