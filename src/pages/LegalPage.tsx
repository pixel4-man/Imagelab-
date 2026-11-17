import { Link } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import { PageTransition } from '../components/PageTransition';

interface LegalPageProps {
  type: 'privacy' | 'terms';
}

export function LegalPage({ type }: LegalPageProps) {
  const isPrivacy = type === 'privacy';

  return (
    <PageTransition>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <div className="mb-5">
          <BackButton fallbackTo="/" label="Back" />
        </div>
        <p className="text-xs font-semibold text-[#2A9D8F] mb-2">
          ImageLab Trust & Guidelines
        </p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#264653] mb-6">
          {isPrivacy ? 'Privacy Policy' : 'Terms of Service'}
        </h1>

        <div className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 p-7 sm:p-10 space-y-6 text-sm text-[#264653]/80 leading-relaxed">
          {isPrivacy ? (
            <>
              <section className="space-y-2">
                <h2 className="text-lg font-bold text-[#264653]">1. Local Session Preferences</h2>
                <p>
                  In this frontend UI preview, your saved prompts and likes are stored strictly in your browser&apos;s local storage so your collection stays intact while navigating between pages. No personal data is transmitted to external servers.
                </p>
              </section>
              <section className="space-y-2">
                <h2 className="text-lg font-bold text-[#264653]">2. Authentication & Profile Data</h2>
                <p>
                  Account sign-in and profile persistence are staged for future backend integration. Any edits made on the Profile or Publish pages apply strictly within your active browser session.
                </p>
              </section>
              <section className="space-y-2">
                <h2 className="text-lg font-bold text-[#264653]">3. Questions</h2>
                <p>
                  Reach out anytime via our{' '}
                  <Link to="/contact" className="text-[#2A9D8F] font-semibold hover:underline">
                    Contact page
                  </Link>
                  .
                </p>
              </section>
            </>
          ) : (
            <>
              <section className="space-y-2">
                <h2 className="text-lg font-bold text-[#264653]">1. Prompt Transparency & Attribution</h2>
                <p>
                  ImageLab is built around open prompt sharing. Prompts published on the platform are readable and copyable by the community for study, experimentation, and creative inspiration, while crediting the original contributor&apos;s handle.
                </p>
              </section>
              <section className="space-y-2">
                <h2 className="text-lg font-bold text-[#264653]">2. Community Conduct</h2>
                <p>
                  Creators agree to submit accurate generation prompts matching their uploaded artwork and refrain from publishing harmful, deceptive, or infringing content.
                </p>
              </section>
              <section className="space-y-2">
                <h2 className="text-lg font-bold text-[#264653]">3. Contact & Moderation</h2>
                <p>
                  If you have questions regarding attribution or content standards, please reach out through the{' '}
                  <Link to="/contact" className="text-[#2A9D8F] font-semibold hover:underline">
                    Contact page
                  </Link>
                  .
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
