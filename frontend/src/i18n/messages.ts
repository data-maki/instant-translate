export type Locale = "ja" | "en";

export const LOCALES: Locale[] = ["ja", "en"];

export const DEFAULT_LOCALE: Locale = "ja";

type Card = {
  eyebrow: string;
  setting: string;
  fabric: string;
  ja: string;
  en: string;
  glyph: string;
  tone: "scarlet" | "gold" | "ink" | "azure";
};

type LandingMessages = {
  brand: { name: string; kanji: string };
  perks: { mark: string; text: string }[];
  marquee: string[];
  nav: { login: string; cta: string };
  toggle: { aria: string; ja: string; en: string };
  hero: {
    live: string;
    h1Line1: string;
    h1Line2Em: string;
    bodyBefore: string;
    bodyStrong: string;
    bodyAfter: string;
    ctaPrimaryKicker: string;
    ctaPrimaryLabel: string;
    ctaSecondary: string;
    ctaMobileTestflight: string;
    ctaMobileWeb: string;
    ctaMobileNote: string;
    proofPrimary: string;
    proofSecondary: string;
    specimenBadge: string;
    specimenStatus: string;
    specimenScene: string;
    specimenGlyphPrimary: string;
    specimenGlyphSecondary: string;
    specimenLinePrimaryLang: Locale;
    specimenLinePrimary: string[];
    specimenLineSecondaryLang: Locale;
    specimenLineSecondary: string;
    specimenSayLabel: string;
    specimenHearLabel: string;
    specimenBeamLabel: string;
    specimenFootMark: string;
  };
  stats: { figure: string; title: string; body: string }[];
  phrases: {
    kicker: string;
    h2Line1: string;
    h2Line2Em: string;
    intro: string;
    link: string;
    cards: Card[];
  };
  story: {
    eyebrow: string;
    bodyLine1: string;
    bodyLine2: string;
    cite: string;
    aside: string;
  };
  footer: { copyright: string; languages: string; login: string };
};

export type Messages = { landing: LandingMessages };

const ja: Messages = {
  landing: {
    brand: { name: "Kotonoha", kanji: "言の葉" },
    perks: [
      { mark: "★", text: "限定ベータ・無料公開中" },
      { mark: "·", text: "毎週水曜 17:00 JST 新シーン解禁" },
      { mark: "·", text: "コード KOTO20 で初月無料" }
    ],
    marquee: [
      "0.5秒で訳す",
      "敬語まで訳す",
      "日本語 ⇄ 英語、リアルタイム",
      "限定ベータ",
      "場の空気まで訳す",
      "学ぶ人のために"
    ],
    nav: { login: "ログイン", cta: "今すぐ起動" },
    toggle: { aria: "言語を切り替え", ja: "日本語", en: "EN" },
    hero: {
      live: "限定ベータ ・ 招待制で公開中",
      h1Line1: "言葉の壁を、",
      h1Line2Em: "撃ち抜け。",
      bodyBefore: "日本語のままで、外国人の同僚・取引先・お客さま・家族と",
      bodyStrong: "通じる",
      bodyAfter: "。会議も、接客も、おもてなしも、声がそのまま伝わる。",
      ctaPrimaryKicker: "無料",
      ctaPrimaryLabel: "今すぐ起動する",
      ctaSecondary: "Start free in English",
      ctaMobileTestflight: "TestFlight をリクエスト",
      ctaMobileWeb: "ブラウザで体験する",
      ctaMobileNote: "モバイル版は招待制（iOS）。デスクトップ／ブラウザでも今すぐ使えます。",
      proofPrimary: "話せば、通じる。",
      proofSecondary: "Speak it. Be understood.",
      specimenBadge: "DROP · 01 / JA ⇄ EN",
      specimenStatus: "BETA",
      specimenScene: "シーン · 職場",
      specimenGlyphPrimary: "通",
      specimenGlyphSecondary: "Z",
      specimenLinePrimaryLang: "ja",
      specimenLinePrimary: ["納期は", "調整可能です。"],
      specimenLineSecondaryLang: "en",
      specimenLineSecondary: "We can adjust the deadline.",
      specimenSayLabel: "あなたの声",
      specimenHearLabel: "相手の耳に",
      specimenBeamLabel: "オーバーダブ",
      specimenFootMark: "リアルタイム音声オーバーダブ"
    },
    stats: [
      {
        figure: "0.5秒",
        title: "会話のテンポは、止めない。",
        body: "「もう一回？」と言われる前に、翻訳が届く。沈黙も、気まずい間も生まれない。"
      },
      {
        figure: "敬語",
        title: "頭の下げ方まで、分かってる。",
        body: "上司には自然に丁寧に、友達には砕けて。相手と場面に合わせて、声のトーンが変わる。"
      },
      {
        figure: "声だけ",
        title: "スマホは、ポケットの中で。",
        body: "タイピングなし、渡し合いなし、翻訳アプリの順番待ちなし。話せば、相手は相手の言葉で聞ける。"
      },
      {
        figure: "残らない",
        title: "話した部屋から、外に出ない。",
        body: "名前も、商談も、家族の話も。会話は、あなたと相手の間にだけ残る。"
      }
    ],
    phrases: {
      kicker: "23 のシーン",
      h2Line1: "職場で、接客で、",
      h2Line2Em: "そのまま、通じる。",
      intro:
        "実際に日本で外国人と働く・暮らす人たちの声で調整した、23 のシーン。敬語、相手との距離、名前の呼び方、場の空気まで訳す。",
      link: "すべてのシーンを見る →",
      cards: [
        {
          eyebrow: "NEW",
          setting: "職場のミーティングで",
          fabric: "Work · Meeting",
          ja: "本日のアジェンダを共有します。",
          en: "I'll walk you through today's agenda.",
          glyph: "議",
          tone: "scarlet"
        },
        {
          eyebrow: "人気",
          setting: "接客中に",
          fabric: "Hospitality · Service",
          ja: "アレルギーのご確認をさせてください。",
          en: "May I check your allergy information?",
          glyph: "客",
          tone: "gold"
        },
        {
          eyebrow: "NEW",
          setting: "海外の取引先へ",
          fabric: "Client · Deadlines",
          ja: "納期は調整可能です。",
          en: "We can adjust the deadline.",
          glyph: "商",
          tone: "ink"
        },
        {
          eyebrow: "FAMILY",
          setting: "義理の家族へ",
          fabric: "Family · Welcome",
          ja: "今日は来てくれてありがとう。",
          en: "Thank you for coming today.",
          glyph: "家",
          tone: "azure"
        }
      ]
    },
    story: {
      eyebrow: "STORY · 2026",
      bodyLine1: "ちょうどいい言葉を、",
      bodyLine2: "ちょうどいい瞬間に。",
      cite: "— ヤン・カルボネル, 創業者 · Kotonoha",
      aside:
        "本気で日本語を学ぼうとして、最初にぶつかったのが敬語の壁でした。「失礼にあたらないか」を気にしすぎて、言いたいことが言えない。その答えとして作ったのがこのアプリです。学ぶ途中でも、相手に失礼なく伝わる声を。"
    },
    footer: {
      copyright: "© 2026 Kotonoha",
      languages: "日本語 · English",
      login: "ログイン"
    }
  }
};

const en: Messages = {
  landing: {
    brand: { name: "cottonoha", kanji: "言の葉" },
    perks: [
      { mark: "★", text: "Free during the private beta" },
      { mark: "·", text: "New scenes drop Wed 17:00 JST" },
      { mark: "·", text: "Use KOTO20 — first month on us" }
    ],
    marquee: [
      "<500MS OVERDUB",
      "KEIGO-AWARE",
      "REAL-TIME JA ⇄ EN",
      "PRIVATE BETA",
      "RESPECTS THE ROOM",
      "BUILT FOR LEARNERS"
    ],
    nav: { login: "Log in", cta: "Get started" },
    toggle: { aria: "Switch language", ja: "日本語", en: "EN" },
    hero: {
      live: "PRIVATE BETA · INVITE-ONLY",
      h1Line1: "Two voices,",
      h1Line2Em: "one room.",
      bodyBefore:
        "Real-time voice overdub between Japanese and English. Meetings, hospitality, the in-laws — both sides hear ",
      bodyStrong: "one conversation",
      bodyAfter: ", not two.",
      ctaPrimaryKicker: "FREE",
      ctaPrimaryLabel: "Try it free",
      ctaSecondary: "日本語ではじめる",
      ctaMobileTestflight: "Request TestFlight invite",
      ctaMobileWeb: "Try it in your browser",
      ctaMobileNote: "iOS app is invite-only. Use it on desktop or in your browser today.",
      proofPrimary: "Speak it. Be understood.",
      proofSecondary: "話せば、通じる。",
      specimenBadge: "DROP · 01 / EN ⇄ JA",
      specimenStatus: "BETA",
      specimenScene: "SCENE · WORKPLACE",
      specimenGlyphPrimary: "Z",
      specimenGlyphSecondary: "通",
      specimenLinePrimaryLang: "en",
      specimenLinePrimary: ["We can adjust the deadline."],
      specimenLineSecondaryLang: "ja",
      specimenLineSecondary: "「納期は調整可能です。」",
      specimenSayLabel: "YOU SAY",
      specimenHearLabel: "ROOM HEARS",
      specimenBeamLabel: "OVERDUB",
      specimenFootMark: "Real-time voice overdub"
    },
    stats: [
      {
        figure: "0.5s",
        title: "Built for the back-and-forth.",
        body: "Translation lands before the silence does. Conversations keep their rhythm — no mid-sentence pauses, no “one more time?”"
      },
      {
        figure: "敬語",
        title: "Knows when to bow.",
        body: "It talks to your boss differently than your best friend — without you thinking about it. Keigo, register, the air of the room."
      },
      {
        figure: "Voice",
        title: "Phone stays in your pocket.",
        body: "No typing. No phone-passing. You speak — they hear it in their language. Your hands stay free to actually be in the conversation."
      },
      {
        figure: "Yours",
        title: "What's said in the room, stays.",
        body: "Names, deal terms, the things you say to family. Your conversation never leaves the session."
      }
    ],
    phrases: {
      kicker: "23 SCENES",
      h2Line1: "Work, hospitality,",
      h2Line2Em: "understood as-is.",
      intro:
        "Twenty-three scenes shaped by people who actually live between Japanese and English. Keigo, distance, names, the room — all carried across.",
      link: "See every scene →",
      cards: [
        {
          eyebrow: "NEW",
          setting: "In a team meeting",
          fabric: "Work · Meeting",
          ja: "本日のアジェンダを共有します。",
          en: "I'll walk you through today's agenda.",
          glyph: "議",
          tone: "scarlet"
        },
        {
          eyebrow: "POPULAR",
          setting: "While serving guests",
          fabric: "Hospitality · Service",
          ja: "アレルギーのご確認をさせてください。",
          en: "May I check your allergy information?",
          glyph: "客",
          tone: "gold"
        },
        {
          eyebrow: "NEW",
          setting: "With overseas clients",
          fabric: "Client · Deadlines",
          ja: "納期は調整可能です。",
          en: "We can adjust the deadline.",
          glyph: "商",
          tone: "ink"
        },
        {
          eyebrow: "FAMILY",
          setting: "To your in-laws",
          fabric: "Family · Welcome",
          ja: "今日は来てくれてありがとう。",
          en: "Thank you for coming today.",
          glyph: "家",
          tone: "azure"
        }
      ]
    },
    story: {
      eyebrow: "STORY · 2026",
      bodyLine1: "The right word,",
      bodyLine2: "at the right moment.",
      cite: "— Jan Carbonell, founder · cottonoha",
      aside:
        "I tried hard to learn Japanese, and the first wall I hit was keigo — worrying I'd be rude meant I couldn't say what I wanted to say. So I built this. The app keeps you respectful while you're still finding the words."
    },
    footer: {
      copyright: "© 2026 cottonoha",
      languages: "日本語 · English",
      login: "Log in"
    }
  }
};

export const messages: Record<Locale, Messages> = { ja, en };
