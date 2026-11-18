import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Mail, MessageSquare, Send } from 'lucide-react';
import { BackButton } from '../components/BackButton';
import { PageTransition } from '../components/PageTransition';
import { SeoHead, resolveCanonicalOrigin } from '../components/SeoHead';

interface ContactErrors {
  name?: string;
  email?: string;
  message?: string;
}

export function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState('Community & Curation');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<ContactErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const validate = () => {
    const next: ContactErrors = {};
    if (!name.trim()) next.name = 'Please enter your name.';
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = 'Please provide a valid email address.';
    }
    if (!message.trim() || message.trim().length < 15) {
      next.message = 'Please share a message of at least 15 characters.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitted(true);
  };

  const canonicalOrigin = resolveCanonicalOrigin();

  return (
    <PageTransition>
      <SeoHead
        title="Contact ImageLab — Curation & Community Inquiries"
        description="Get in touch with the ImageLab curation team for creator spotlights, attribution questions, or community partnerships."
        canonicalPath="/contact"
        structuredData={{
          '@context': 'https://schema.org',
          '@type': 'ContactPage',
          name: 'Contact ImageLab',
          url: `${canonicalOrigin}/contact`,
        }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <div className="mb-5">
          <BackButton fallbackTo="/" label="Back" />
        </div>
        <div className="max-w-2xl mb-10">
          <p className="text-xs font-semibold text-[#2A9D8F] mb-2">
            Contact ImageLab
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#264653] mb-3">
            Questions, Curation & Partnerships
          </h1>
          <p className="text-base text-[#264653]/75 leading-relaxed">
            Reach out to our editorial curation team for feature requests, creator spotlights, or community feedback.
          </p>
        </div>

        <section
          data-ad-slot="contact_main"
          data-ad-label="Contact Page Main Section"
          className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start"
        >
          {/* Contact Form */}
          <div className="lg:col-span-7 rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 p-6 sm:p-8 shadow-sm">
            {submitted ? (
              <div className="py-10 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-[#2A9D8F]/14 text-[#2A9D8F] flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
                </div>
                <h2 className="text-2xl font-bold text-[#264653]">
                  Message Ready (Frontend Preview)
                </h2>
                <p className="text-sm text-[#264653]/75 max-w-md mx-auto leading-relaxed">
                  Thank you, <strong>{name}</strong>. Your inquiry under{' '}
                  <strong>{topic}</strong> was validated cleanly. Live email dispatch will connect in the backend phase.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSubmitted(false);
                    setName('');
                    setEmail('');
                    setMessage('');
                  }}
                  className="px-5 py-2.5 rounded-xl bg-[#264653] hover:bg-[#355C6B] text-white text-sm font-semibold transition-colors"
                >
                  Compose Another Message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="contact-name"
                      className="block text-xs font-bold text-[#264653] mb-1.5"
                    >
                      Your Name <span className="text-[#E76F51]">*</span>
                    </label>
                    <input
                      id="contact-name"
                      type="text"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (errors.name) setErrors((p) => ({ ...p, name: undefined }));
                      }}
                      placeholder="Clara Bergman"
                      className={`w-full h-11 px-4 rounded-xl bg-[#F4EDE4]/55 border text-sm text-[#264653] focus:outline-none focus:ring-2 ${
                        errors.name
                          ? 'border-[#E76F51] focus:ring-[#E76F51]/25'
                          : 'border-[#264653]/15 focus:border-[#2A9D8F] focus:ring-[#2A9D8F]/20'
                      }`}
                    />
                    {errors.name && (
                      <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#D05A3C]">
                        <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{errors.name}</span>
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="contact-email"
                      className="block text-xs font-bold text-[#264653] mb-1.5"
                    >
                      Email Address <span className="text-[#E76F51]">*</span>
                    </label>
                    <input
                      id="contact-email"
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
                      }}
                      placeholder="clara@studio.dk"
                      className={`w-full h-11 px-4 rounded-xl bg-[#F4EDE4]/55 border text-sm text-[#264653] focus:outline-none focus:ring-2 ${
                        errors.email
                          ? 'border-[#E76F51] focus:ring-[#E76F51]/25'
                          : 'border-[#264653]/15 focus:border-[#2A9D8F] focus:ring-[#2A9D8F]/20'
                      }`}
                    />
                    {errors.email && (
                      <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#D05A3C]">
                        <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{errors.email}</span>
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="contact-topic"
                    className="block text-xs font-bold text-[#264653] mb-1.5"
                  >
                    Topic
                  </label>
                  <select
                    id="contact-topic"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/55 border border-[#264653]/15 text-sm text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
                  >
                    <option value="Community & Curation">Community & Curation</option>
                    <option value="Creator Spotlight">Creator Spotlight</option>
                    <option value="Technical Feedback">Technical Feedback</option>
                    <option value="Attribution & Rights">Attribution & Rights</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="contact-message"
                    className="block text-xs font-bold text-[#264653] mb-1.5"
                  >
                    Message <span className="text-[#E76F51]">*</span>
                  </label>
                  <textarea
                    id="contact-message"
                    rows={5}
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value);
                      if (errors.message) setErrors((p) => ({ ...p, message: undefined }));
                    }}
                    placeholder="Tell us what you are working on or how we can help..."
                    className={`w-full p-4 rounded-xl bg-[#F4EDE4]/55 border text-sm text-[#264653] focus:outline-none focus:ring-2 leading-relaxed ${
                      errors.message
                        ? 'border-[#E76F51] focus:ring-[#E76F51]/25'
                        : 'border-[#264653]/15 focus:border-[#2A9D8F] focus:ring-[#2A9D8F]/20'
                    }`}
                  />
                  {errors.message && (
                    <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#D05A3C]">
                      <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{errors.message}</span>
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors min-h-[46px]"
                >
                  <Send className="w-4 h-4" aria-hidden="true" />
                  <span>Send Message</span>
                </button>
              </form>
            )}
          </div>

          {/* Direct Info & FAQ */}
          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/12 p-6 space-y-4">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-[#F4EDE4] text-[#2A9D8F] flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#264653]">Editorial Desk</h2>
                  <p className="text-xs text-[#264653]/70 mt-0.5">
                    hello@imagelab.community
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-[#F4EDE4] text-[#E76F51] flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#264653]">Creator Submissions</h2>
                  <p className="text-xs text-[#264653]/70 mt-0.5">
                    Every prompt published on ImageLab is reviewed for clarity and complete prompt transparency.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/12 p-6 space-y-4">
              <h2 className="text-base font-bold text-[#264653]">
                Frequently Asked Questions
              </h2>
              <div className="space-y-4 text-xs leading-relaxed">
                <div>
                  <p className="font-bold text-[#264653] mb-1">
                    Can I copy and adapt prompts for my own projects?
                  </p>
                  <p className="text-[#264653]/75">
                    Yes. All prompts shared on ImageLab are open to copy, study, and remix across personal and creative experiments.
                  </p>
                </div>
                <div className="pt-3 border-t border-[#264653]/10">
                  <p className="font-bold text-[#264653] mb-1">
                    What makes a prompt helpful to other creators?
                  </p>
                  <p className="text-[#264653]/75">
                    Specify light direction, material texture, camera or brush medium, and composition rather than vague buzzwords.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </PageTransition>
  );
}
