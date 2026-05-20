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
    link: string;
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
      "日本で生まれた",
      "声のまま訳す",
      "リアルタイム・同時通訳",
      "PRIVATE BETA",
      "MAZIN ・ GO !",
      "東京発・世界へ"
    ],
    nav: { login: "ログイン", cta: "今すぐ起動" },
    toggle: { aria: "言語を切り替え", ja: "日本語", en: "EN" },
    hero: {
      live: "起動中 ・ 今週 2,318 件の会話が「通じた」",
      h1Line1: "言葉の壁を、",
      h1Line2Em: "撃ち抜け。",
      bodyBefore: "日本語のままで、外国人の同僚・取引先・お客さま・家族と",
      bodyStrong: "通じる",
      bodyAfter: "。会議も、接客も、おもてなしも、声がそのまま伝わる。",
      ctaPrimaryKicker: "無料",
      ctaPrimaryLabel: "今すぐ起動する",
      ctaSecondary: "English? Start free",
      proofPrimary: "話せば、通じる。",
      proofSecondary: "Speak it. Be understood.",
      specimenBadge: "★ DROP · 01 / JA ⇄ EN",
      specimenStatus: "起動中",
      specimenScene: "シーン · 職場",
      specimenGlyphPrimary: "通",
      specimenGlyphSecondary: "Z",
      specimenLinePrimaryLang: "ja",
      specimenLinePrimary: ["納期は", "調整可能です。"],
      specimenLineSecondaryLang: "en",
      specimenLineSecondary: "↳ We can adjust the deadline."
    },
    stats: [
      {
        figure: "<0.5秒",
        title: "起動から声まで",
        body: "文が終わる前に、相手の言語で響く。部屋に流れるのは、二つの意味と、一つの声。"
      },
      {
        figure: "23",
        title: "対応シーン",
        body: "居酒屋・旅館・診療所・職場・取引先・家族。場の空気と敬語まで訳す。"
      },
      {
        figure: "100%",
        title: "タイピング不要",
        body: "話せばいい。スマホを渡し合う必要はない。キーボードも、翻訳アプリの順番待ちもない。"
      },
      {
        figure: "1:1",
        title: "完全プライベート",
        body: "名前も、商談の中身も、家族の話も、端末の外には出ない。"
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
      eyebrow: "STORY · 東京 · 2026",
      bodyLine1: "ちょうどいい言葉を、",
      bodyLine2: "ちょうどいい瞬間に。",
      cite: "— リン, 創業者 · コトノハ",
      aside:
        "訳すのは単語じゃなく、部屋の空気。敬語、関係、アレルギー、家族の名前。日本で、外国人と本当に話す人たちの手で作っています。",
      link: "はじまりを読む"
    },
    footer: {
      copyright: "© 2026 コトノハ · 東京",
      languages: "日本語 · English",
      login: "ログイン"
    }
  }
};

const en: Messages = {
  landing: {
    perks: [
      { mark: "★", text: "Free during the private beta" },
      { mark: "·", text: "New scenes drop Wed 17:00 JST" },
      { mark: "·", text: "Use KOTO20 — first month on us" }
    ],
    marquee: [
      "BUILT IN TOKYO",
      "SPOKEN, NOT TYPED",
      "REAL-TIME OVERDUB",
      "PRIVATE BETA",
      "MAZIN · GO !",
      "JA ⇄ EN, LIVE"
    ],
    nav: { login: "Log in", cta: "Get started" },
    toggle: { aria: "Switch language", ja: "日本語", en: "EN" },
    hero: {
      live: "LIVE · 2,318 rooms decoded this week",
      h1Line1: "Two voices,",
      h1Line2Em: "one room.",
      bodyBefore:
        "Real-time voice overdub between Japanese and English. Meetings, hospitality, the in-laws — both sides hear ",
      bodyStrong: "one conversation",
      bodyAfter: ", not two."
,
      ctaPrimaryKicker: "FREE",
      ctaPrimaryLabel: "Try it free",
      ctaSecondary: "日本語ではじめる",
      proofPrimary: "Speak it. Be understood.",
      proofSecondary: "話せば、通じる。",
      specimenBadge: "★ DROP · 01 / EN ⇄ JA",
      specimenStatus: "LIVE",
      specimenScene: "SCENE · WORKPLACE",
      specimenGlyphPrimary: "Z",
      specimenGlyphSecondary: "通",
      specimenLinePrimaryLang: "en",
      specimenLinePrimary: ["We can adjust", "the deadline."],
      specimenLineSecondaryLang: "ja",
      specimenLineSecondary: "↳ 納期は調整可能です。"
    },
    stats: [
      {
        figure: "<0.5s",
        title: "Sub-second overdub",
        body: "Translation lands before the sentence ends. One voice in the room, two meanings carried."
      },
      {
        figure: "23",
        title: "Scenes tuned",
        body: "Workplace, client calls, hospitality, clinics, family. Keigo, register, and the feel of the room — all translated."
      },
      {
        figure: "100%",
        title: "Spoken, not typed",
        body: "Just talk. No phone-passing. No keyboards. No waiting your turn in a translation app."
      },
      {
        figure: "1:1",
        title: "Private by default",
        body: "Names, deal terms, family details — they stay on your device. Nothing leaves the session."
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
      eyebrow: "STORY · TOKYO · 2026",
      bodyLine1: "The right word,",
      bodyLine2: "at the right moment.",
      cite: "— Lin, founder · cottonoha",
      aside:
        "Every translation respects the room — keigo, relationship, allergies, family names. Built in Tokyo, by people who live on both sides of the conversation.",
      link: "Read the story"
    },
    footer: {
      copyright: "© 2026 cottonoha · Tokyo",
      languages: "日本語 · English",
      login: "Log in"
    }
  }
};

export const messages: Record<Locale, Messages> = { ja, en };
