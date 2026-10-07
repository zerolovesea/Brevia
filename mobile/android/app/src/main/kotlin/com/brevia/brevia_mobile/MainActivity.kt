package com.brevia.brevia_mobile

import com.cloudwebrtc.webrtc.audio.AudioSwitchManager
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    init {
        // WebRTC 只传数据，音频焦点和路由仍由录音器管理。
        AudioSwitchManager.setAudioSessionManagementEnabled(false)
    }
}
