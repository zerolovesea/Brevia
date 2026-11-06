// swift-tools-version:6.2
import PackageDescription

let package = Package(
  name: "BreviaInference", platforms: [.macOS(.v14)],
  dependencies: [
    .package(url: "https://github.com/Neywa-Labs/mlx-audio-swift.git", exact: "0.1.8")
  ],
  targets: [
    .executableTarget(
      name: "brevia-mlx",
      dependencies: [.product(name: "MLXAudioSTT", package: "mlx-audio-swift")],
      path: "Sources"
    )
  ],
  swiftLanguageModes: [.v5]
)
