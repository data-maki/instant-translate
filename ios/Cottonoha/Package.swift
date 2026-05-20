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
    dependencies: [
        .package(url: "https://github.com/ouwargui/BetterAuthSwift.git", .upToNextMajor(from: "2.1.1"))
    ],
    targets: [
        .target(
            name: "CottonohaCore",
            dependencies: [
                .product(name: "BetterAuth", package: "BetterAuthSwift")
            ],
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
