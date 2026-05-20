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
            name: "CottonohaApp",
            targets: ["CottonohaApp"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/ouwargui/BetterAuthSwift.git", .upToNextMajor(from: "2.1.1"))
    ],
    targets: [
        .target(
            name: "CottonohaApp",
            dependencies: [
                .product(name: "BetterAuth", package: "BetterAuthSwift")
            ],
            resources: [
                .process("Resources")
            ],
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency")
            ]
        )
    ]
)
