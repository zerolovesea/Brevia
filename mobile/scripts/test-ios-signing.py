"""离线验证 CI 为主应用和扩展分别安装描述文件，并拒绝无效签名配置。"""

import base64
import datetime
import os
from pathlib import Path
import plistlib
import tempfile
from unittest.mock import patch

source = (
    Path(__file__)
    .with_name('ios-signing.sh')
    .read_text()
    .split("python3 - <<'PY'\n")[1]
    .split('\nPY\n')[0]
)
bundles = ['com.brevia.breviaMobile', 'com.brevia.breviaMobile.RecordingActivity']

for invalid in [None, 'bundle', 'development', 'expired', 'adhoc', 'managed']:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        env = {
            'RUNNER_TEMP': directory,
            'ASC_KEY_P8_BASE64': 'dGVzdA==',
            'IOS_CERTIFICATE_P12_BASE64': 'dGVzdA==',
        }
        for index, (secret, bundle) in enumerate(
            zip(['IOS_PROFILE_BASE64', 'IOS_EXTENSION_PROFILE_BASE64'], bundles)
        ):
            profile = {
                'UUID': f'profile-{index}',
                'Entitlements': {
                    'application-identifier': '4M64879BBM.' + bundle,
                    'get-task-allow': False,
                },
                'ExpirationDate': datetime.datetime(2099, 1, 1),
            }
            if index == 1:
                if invalid == 'bundle':
                    profile['Entitlements']['application-identifier'] = 'wrong.app'
                elif invalid == 'development':
                    profile['Entitlements']['get-task-allow'] = True
                elif invalid == 'expired':
                    profile['ExpirationDate'] = datetime.datetime(2000, 1, 1)
                elif invalid == 'managed':
                    profile['IsXcodeManaged'] = True
                elif invalid == 'adhoc':
                    profile['ProvisionedDevices'] = ['device']
            env[secret] = base64.b64encode(plistlib.dumps(profile)).decode()
        with (
            patch.dict(os.environ, env),
            patch('pathlib.Path.home', return_value=root),
            patch('subprocess.check_output', side_effect=lambda args: Path(args[-1]).read_bytes()),
        ):
            try:
                exec(compile(source, 'ios-signing.sh', 'exec'), {})
            except AssertionError:
                assert invalid is not None
                assert not (root / 'brevia-export.plist').exists()
            else:
                assert invalid is None
                options = plistlib.loads((root / 'brevia-export.plist').read_bytes())
                assert options['signingStyle'] == 'manual'
                assert options['provisioningProfiles'] == dict(
                    zip(bundles, ['profile-0', 'profile-1'])
                )
                assert options['manageAppVersionAndBuildNumber'] is False
                installed = (root / 'brevia-profile-paths').read_text().splitlines()
                assert len(installed) == 2 and all(Path(p).is_file() for p in installed)
print('iOS signing safeguards passed')
