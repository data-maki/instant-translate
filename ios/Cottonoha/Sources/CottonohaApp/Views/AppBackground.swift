import SwiftUI

struct AppBackground: View {
    var body: some View {
        LinearGradient(
            colors: [
                Color(red: 0.99, green: 0.98, blue: 0.94),
                Color(red: 0.93, green: 0.95, blue: 0.93)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }
}
