#!/usr/bin/env bash
set -euo pipefail
umask 077
for name in IOS_CERTIFICATE_P12_BASE64 IOS_CERTIFICATE_PASSWORD IOS_PROFILE_BASE64 IOS_EXTENSION_PROFILE_BASE64 ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_P8_BASE64; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::Missing GitHub Secret: $name (see mobile/README.md)"
    exit 1
  fi
done
export BREVIA_KEYCHAIN="$RUNNER_TEMP/brevia-signing.keychain-db"
KEYCHAIN_PASSWORD=$(openssl rand -hex 32)
echo "::add-mask::$KEYCHAIN_PASSWORD"
python3 - <<'PY'
import base64, datetime, os, pathlib, plistlib, subprocess
root = pathlib.Path(os.environ['RUNNER_TEMP'])
(root / 'brevia-asc.p8').write_bytes(base64.b64decode(os.environ['ASC_KEY_P8_BASE64'], validate=True))
(root / 'brevia-distribution.p12').write_bytes(base64.b64decode(os.environ['IOS_CERTIFICATE_P12_BASE64'], validate=True))
dest = pathlib.Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles'
dest.mkdir(parents=True, exist_ok=True)
profiles = {}
# 主应用和实时活动扩展分别签名；不依赖 CI 账号的云签名权限。
for secret, bundle in (
    ('IOS_PROFILE_BASE64', 'com.brevia.breviaMobile'),
    ('IOS_EXTENSION_PROFILE_BASE64', 'com.brevia.breviaMobile.RecordingActivity'),
):
    profile = root / (bundle + '.mobileprovision')
    profile.write_bytes(base64.b64decode(os.environ[secret], validate=True))
    data = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(profile)]))
    assert data['Entitlements']['application-identifier'] == '4M64879BBM.' + bundle, 'Wrong provisioning profile: ' + bundle
    assert not data.get('IsXcodeManaged', False), 'Manually managed profile required: ' + bundle
    assert not data['Entitlements'].get('get-task-allow', True), 'Development profile is not permitted'
    assert 'ProvisionedDevices' not in data and not data.get('ProvisionsAllDevices'), 'App Store profile required'
    assert data['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), 'Expired provisioning profile: ' + bundle
    installed = dest / (data['UUID'] + '.mobileprovision')
    with (root / 'brevia-profile-paths').open('a') as paths:
        paths.write(str(installed) + '\n')
    installed.write_bytes(profile.read_bytes())
    profiles[bundle] = data['UUID']
(root / 'brevia-export.plist').write_bytes(plistlib.dumps({
    'method': 'app-store-connect', 'destination': 'export', 'teamID': '4M64879BBM',
    'signingStyle': 'manual', 'signingCertificate': 'Apple Distribution',
    'provisioningProfiles': profiles,
    'manageAppVersionAndBuildNumber': False,
}))
PY
security create-keychain -p "$KEYCHAIN_PASSWORD" "$BREVIA_KEYCHAIN"
security set-keychain-settings -lut 21600 "$BREVIA_KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$BREVIA_KEYCHAIN"
security import "$RUNNER_TEMP/brevia-distribution.p12" -k "$BREVIA_KEYCHAIN" -P "$IOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$BREVIA_KEYCHAIN" >/dev/null
security list-keychains -d user -s "$BREVIA_KEYCHAIN" "$HOME/Library/Keychains/login.keychain-db"
