// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Cottonoha",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v17),
        .macOS(.v15)
    ],
    products: [
        .library(
            name: "CottonohaCore",
            targets: ["CottonohaCore"]
        )
    ],
    dependencies: [],
    targets: [
        .target(
            name: "CottonohaCore",
            dependencies: [],
            path: "Sources/CottonohaApp",
            resources: [
                .process("Resources")
            ],
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency")
            ]
        )
    ]
)
