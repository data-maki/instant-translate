"use client";

import Image from "next/image";
import Link from "next/link";
import { LocaleToggle } from "@/components/LocaleToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLocale } from "@/i18n/LocaleProvider";

export function LandingPage() {
  const { locale, t } = useLocale();
  const m = t.landing;
  const otherLocale = locale === "ja" ? "en" : "ja";

  return (
    <main className="landingPage" lang={locale}>
      <div className="landingAnnouncement" aria-label={locale === "ja" ? "お知らせ" : "Updates"}>
        {m.perks.map((p) => (
          <span key={p.text} className="landingPerk">
            <span aria-hidden="true">{p.mark}</span>
            {p.text}
          </span>
        ))}
      </div>

      <header className="landingNav">
        <Link className="landingBrand" href="/">
          <span className="brandMark compact" aria-hidden="true">
            <Image alt="" height={34} src="/favicon.svg" width={34} />
          </span>
          <span>{m.brand.name}</span>
          <span className="brandKanji" lang="ja">{m.brand.kanji}</span>
        </Link>
        <div className="landingNavRight">
          <ThemeToggle compact />
          <LocaleToggle />
          <Link className="landingNavLogin" href="/sign-in">
            {m.nav.login}
          </Link>
          <Link className="landingNavCta heroDesktopCta" href={`/sign-up?locale=${locale}`}>
            {m.nav.cta}
            <span aria-hidden="true">→</span>
          </Link>
          <a
            className="landingNavCta heroMobileCta"
            href="mailto:jcllobet@gmail.com?subject=cottonoha%20TestFlight%20invite"
            aria-label={m.hero.ctaMobileTestflight}
          >
            TestFlight
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </header>

      <div className="landingMarquee" aria-hidden="true">
        <div className="landingMarqueeTrack">
          {[...m.marquee, ...m.marquee, ...m.marquee].map((label, i) => (
            <span key={i}>
              <span className="landingMarqueeStar">✦</span>
              {label}
            </span>
          ))}
        </div>
      </div>

      <section className="landingHero">
        <div className="landingHeroCopy">
          <div className="landingLive">
            <span aria-hidden="true" />
            {m.hero.live}
          </div>
          <h1>
            <span>{m.hero.h1Line1}</span>
            <span>
              <em>{m.hero.h1Line2Em}</em>
            </span>
          </h1>
          <p>
            {m.hero.bodyBefore}
            <strong>{m.hero.bodyStrong}</strong>
            {m.hero.bodyAfter}
          </p>
          <div className="landingHeroActions">
            <Link className="ctaPrimary mechaCta heroDesktopCta" href={`/sign-up?locale=${locale}`}>
              <span className="mechaCtaKicker" aria-hidden="true">
                {m.hero.ctaPrimaryKicker}
              </span>
              <span className="mechaCtaLabel">{m.hero.ctaPrimaryLabel}</span>
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              className="ctaSecondary mechaCtaSecondary heroDesktopCta"
              href={`/sign-up?locale=${otherLocale}`}
              lang={otherLocale}
            >
              {m.hero.ctaSecondary}
              <span aria-hidden="true">→</span>
            </Link>
            <a
              className="ctaPrimary mechaCta heroMobileCta"
              href="mailto:jcllobet@gmail.com?subject=cottonoha%20TestFlight%20invite"
            >
              <span className="mechaCtaKicker" aria-hidden="true">iOS</span>
              <span className="mechaCtaLabel">{m.hero.ctaMobileTestflight}</span>
              <span aria-hidden="true">→</span>
            </a>
            <Link className="ctaSecondary mechaCtaSecondary heroMobileCta" href={`/sign-up?locale=${locale}`}>
              {m.hero.ctaMobileWeb}
              <span aria-hidden="true">→</span>
            </Link>
            <p className="heroMobileNote heroMobileCta">{m.hero.ctaMobileNote}</p>
          </div>
          <div className="landingHeroProof">
            <span lang={locale}>{m.hero.proofPrimary}</span>
            <span lang={otherLocale}>{m.hero.proofSecondary}</span>
          </div>
        </div>

        <aside
          className="landingSpecimen mechaCockpit"
          aria-label={`${m.hero.specimenScene}: ${m.hero.specimenLinePrimary.join("")} ${m.hero.specimenLineSecondary}`}
        >
          <div className="mechaSunburst" aria-hidden="true" />
          <div className="mechaHalftone" aria-hidden="true" />
          <span className="mechaCorner tl" aria-hidden="true" />
          <span className="mechaCorner tr" aria-hidden="true" />
          <span className="mechaCorner bl" aria-hidden="true" />
          <span className="mechaCorner br" aria-hidden="true" />

          <div className="landingSpecimenTop">
            <span className="landingDropBadge">{m.hero.specimenBadge}</span>
            <span className="landingSpecimenPing">
              <span aria-hidden="true" /> {m.hero.specimenStatus}
            </span>
          </div>
          <div className={`landingSpecimenBody specimenLocale-${locale}`}>
            {locale === "en" ? (
              <div className="overdubBoard">
                <div className="overdubLine">
                  <span className="overdubLabel">{m.hero.specimenSayLabel} · EN</span>
                  <p lang={m.hero.specimenLinePrimaryLang}>
                    “{m.hero.specimenLinePrimary.join(" ")}”
                  </p>
                </div>
                <div className="overdubBeam" aria-hidden="true">
                  <span className="overdubBeamLabel">{m.hero.specimenBeamLabel}</span>
                </div>
                <div className="overdubLine">
                  <span className="overdubLabel">{m.hero.specimenHearLabel} · JA</span>
                  <p lang={m.hero.specimenLineSecondaryLang}>{m.hero.specimenLineSecondary}</p>
                </div>
              </div>
            ) : (
              <>
                <span className="landingSpecimenKanji" aria-hidden="true">
                  {m.hero.specimenGlyphPrimary}
                </span>
                <span className="mechaZ" aria-hidden="true">
                  {m.hero.specimenGlyphSecondary}
                </span>
              </>
            )}
          </div>
          <div className="landingSpecimenFoot">
            <div>
              <small>{m.hero.specimenScene}</small>
              {locale === "ja" ? (
                <>
                  <strong lang={m.hero.specimenLinePrimaryLang}>
                    {m.hero.specimenLinePrimary.map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < m.hero.specimenLinePrimary.length - 1 && <br />}
                      </span>
                    ))}
                  </strong>
                  <p className="mechaEcho" lang={m.hero.specimenLineSecondaryLang}>
                    ↳ {m.hero.specimenLineSecondary}
                  </p>
                </>
              ) : (
                <strong className="overdubFootMark">{m.hero.specimenFootMark}</strong>
              )}
            </div>
            <span className="landingSpecimenArrow" aria-hidden="true">
              ↗
            </span>
          </div>
        </aside>
      </section>

      <section className="landingStatsBand">
        {m.stats.map((s) => (
          <article className="landingStat" key={s.title}>
            <span className="landingStatFigure">{s.figure}</span>
            <div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="landingPhrasesBand">
        <header className="landingPhrasesHead">
          <div>
            <p className="panelKicker">{m.phrases.kicker}</p>
            <h2>
              {m.phrases.h2Line1}
              <br />
              <em>{m.phrases.h2Line2Em}</em>
            </h2>
          </div>
          <div className="landingPhrasesIntro">
            <p>{m.phrases.intro}</p>
            <Link className="landingLinkArrow" href={`/sign-up?locale=${locale}`}>
              {m.phrases.link}
            </Link>
          </div>
        </header>

        <div className="landingPhraseGrid">
          {m.phrases.cards.map((card) => (
            <article className={`landingPhraseCard tone-${card.tone}`} key={card.setting}>
              <div className="landingPhraseTag">{card.eyebrow}</div>
              <span className="landingPhraseGlyph" aria-hidden="true">
                {card.glyph}
              </span>
              <footer className="landingPhraseFoot">
                <strong>{card.setting}</strong>
                <span>{card.fabric}</span>
                <p lang="ja">{card.ja}</p>
                <p lang="en">{card.en}</p>
              </footer>
            </article>
          ))}
        </div>
      </section>

      <section className="landingQuoteBand">
        <blockquote>
          <p className="landingQuoteEyebrow">{m.story.eyebrow}</p>
          <p className="landingQuoteBody">
            <span aria-hidden="true">{locale === "ja" ? "「" : "“"}</span>
            {m.story.bodyLine1}
            <br />
            {m.story.bodyLine2}
            <span aria-hidden="true">{locale === "ja" ? "」" : "”"}</span>
          </p>
        </blockquote>
        <div className="landingQuoteAside">
          <p>{m.story.aside}</p>
          <cite>{m.story.cite}</cite>
        </div>
      </section>

      <footer className="landingFooter">
        <Link className="landingBrand landingBrandLarge" href="/">
          <span>{m.brand.name}</span>
          <span className="brandKanji" lang="ja">{m.brand.kanji}</span>
        </Link>
        <div className="landingFooterRule">
          <span>{m.footer.copyright}</span>
          <span>{m.footer.languages}</span>
          <Link href="/sign-in">{m.footer.login}</Link>
        </div>
      </footer>
    </main>
  );
}
