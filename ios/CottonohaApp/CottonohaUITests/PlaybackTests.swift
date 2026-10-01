import XCTest

@MainActor final class PlaybackTests: XCTestCase {
    func testParagraphPlaybackAndHistory() async throws {
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:18766/reset")!)
        reset.httpMethod = "POST"
        reset.setValue("OpenAI File Downloader, XaiImageApiFetch/1.0", forHTTPHeaderField: "User-Agent")
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let app = XCUIApplication()
        app.launchArguments = ["-cottonoha.hasCompletedOnboarding.v1", "YES"]
        app.launchEnvironment["COTTONOHA_API_BASE_URL"] = "http://127.0.0.1:18766"
        app.launch()
        XCTAssertTrue(app.buttons["History"].waitForExistence(timeout: 10))
        app.buttons["History"].tap()
        let history = app.buttons.containing(.staticText, identifier: "Station directions").firstMatch
        XCTAssertTrue(history.waitForExistence(timeout: 5))
        history.tap()
        let bg = app.buttons["Play paragraph in Bulgarian"].firstMatch
        let en = app.buttons["Play paragraph in English"].firstMatch
        XCTAssertTrue(bg.waitForExistence(timeout: 5))
        if !bg.isHittable { app.scrollViews.firstMatch.swipeUp() }
        XCTAssertTrue(bg.isHittable)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "[Kade e garata?]")).firstMatch.exists)
        bg.tap()
        await waitForValue(bg, "Playing")
        await waitForCompletion(bg)
        en.tap()
        await waitForValue(en, "Playing")
        await waitForCompletion(en)
        bg.tap() // Exact-text replay should use cached PCM.
        await waitForValue(bg, "Playing")
        await waitForCompletion(bg)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Compact paragraph playback"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        var request = URLRequest(url: URL(string: "http://127.0.0.1:18766/requests")!)
        request.setValue("OpenAI File Downloader, XaiImageApiFetch/1.0", forHTTPHeaderField: "User-Agent")
        let (data, _) = try await URLSession.shared.data(for: request)
        let payloads = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: String]])
        XCTAssertEqual(payloads.map { $0["text"] }, ["Къде е гарата? Благодаря!", "Where is the station? Thank you!"])
        XCTAssertEqual(payloads.map { $0["target_language"] }, ["bg", "en"])

        app.buttons["New chat"].tap()
        XCTAssertFalse(bg.exists)
        app.buttons["History"].tap()
        XCTAssertTrue(history.waitForExistence(timeout: 5))
        history.tap()
        XCTAssertTrue(bg.waitForExistence(timeout: 5))
    }

    private func waitForValue(_ element: XCUIElement, _ value: String) async {
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: element)
        await fulfillment(of: [expected], timeout: 8)
    }

    private func waitForCompletion(_ element: XCUIElement) async {
        let ended = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '' OR value == nil"), object: element)
        await fulfillment(of: [ended], timeout: 8)
    }
}
