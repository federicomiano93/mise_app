import { useState } from 'react';
import { Button } from 'react-aria-components';
import { Hand } from 'lucide-react';
import styles from './Foundations.module.css';

// One entry per swatch: the name a person reads and the design token it shows. The block
// colour is the token itself, so the page can never drift from tokens.css.
const SWATCHES = [
  { name: 'Accent', token: '--accent' },
  { name: 'Allergen / danger', token: '--danger' },
  { name: 'To check', token: '--warn' },
  { name: 'Done', token: '--ok' },
  { name: 'Rail', token: '--rail' },
  { name: 'Ground', token: '--bg' },
] as const;

function tappedText(count: number): string {
  if (count === 0) return 'Not tapped yet';
  return count === 1 ? 'Tapped 1 time' : `Tapped ${count} times`;
}

// The first screen of Mise 2: proves the stack, the fonts, the colours and a touch target
// work on a phone and a tablet. No routing, no Firebase, no i18n yet.
export function Foundations() {
  const [taps, setTaps] = useState(0);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.mark} aria-hidden="true">M</div>
        <h1 className={styles.title}>Mise 2</h1>
      </header>

      <p className={styles.lead}>
        The foundations of the new app. Sections will arrive here one at a time — the app you
        use every day is unchanged.
      </p>

      <div className={styles.cards}>
        <section className={styles.card}>
          <h2 className={styles.kicker}>Colours</h2>
          <div className={styles.swatches}>
            {SWATCHES.map(({ name, token }) => (
              <div key={token} className={styles.swatch}>
                <div className={styles.block} style={{ background: `var(${token})` }} />
                <span className={styles.swatchName}>{name}</span>
                <span className={styles.swatchToken}>{token}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.kicker}>Type</h2>
          <p className={styles.sample}>Aa Bb Cc — 0123456789</p>
          <p className={styles.sampleMono}>12.50 kg · 0123456789</p>
          <p className={styles.note}>
            Geist and Geist Mono travel with the app, so they work offline.
          </p>
        </section>

        <section className={styles.card}>
          <h2 className={styles.kicker}>Touch</h2>
          <div className={styles.touchRow}>
            <Button className={styles.primary} onPress={() => setTaps(count => count + 1)}>
              <Hand aria-hidden="true" />
              <span>Tap to test</span>
            </Button>
            <p className={styles.counter} aria-live="polite">{tappedText(taps)}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
