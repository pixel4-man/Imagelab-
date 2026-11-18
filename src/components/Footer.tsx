import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ImageLabLogo } from './Navbar';

export function Footer() {
  return (
    <footer
      data-ad-slot="site_footer"
      data-ad-label="Website Footer"
      className="bg-[#264653] text-[#F4EDE4] border-t border-[#FAF7F2]/10 mt-20"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-10 lg:gap-8">
          {/* Brand Column */}
          <div className="lg:col-span-4 space-y-4">
            <Link to="/" className="inline-block">
              <ImageLabLogo inverted />
            </Link>
            <p className="text-sm text-[#F4EDE4]/75 leading-relaxed max-w-sm">
              A curated creative community dedicated to transparent generative craft—discover extraordinary AI images, study the exact prompts behind them, and share your visual process.
            </p>
            <div className="flex items-center gap-3 pt-1">
              {[
                { label: 'Instagram', href: 'https://instagram.com' },
                { label: 'X / Twitter', href: 'https://x.com' },
                { label: 'Behance', href: 'https://behance.net' },
                { label: 'GitHub', href: 'https://github.com' },
              ].map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#FAF7F2]/8 hover:bg-[#E76F51] text-xs font-medium text-[#F4EDE4] transition-colors"
                >
                  <span>{social.label}</span>
                  <ArrowUpRight className="w-3 h-3 opacity-75" aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>

          {/* Platform Links */}
          <div className="lg:col-span-3 space-y-3">
            <h3 className="text-xs font-semibold tracking-wide text-[#F4EDE4]/55">
              Discover
            </h3>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link to="/explore" className="text-[#F4EDE4]/85 hover:text-[#E76F51] transition-colors">
                  Explore Prompts
                </Link>
              </li>
              <li>
                <Link to="/trending" className="text-[#F4EDE4]/85 hover:text-[#E76F51] transition-colors">
                  Trending Artwork
                </Link>
              </li>
              <li>
                <Link to="/publish" className="text-[#F4EDE4]/85 hover:text-[#E76F51] transition-colors">
                  Publish a Prompt
                </Link>
              </li>
              <li>
                <Link to="/saved" className="text-[#F4EDE4]/85 hover:text-[#E76F51] transition-colors">
                  Saved Prompts
                </Link>
              </li>
            </ul>
          </div>

          {/* Community & Info */}
          <div className="lg:col-span-2 space-y-3">
            <h3 className="text-xs font-semibold tracking-wide text-[#F4EDE4]/55">
              Community
            </h3>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link to="/about" className="text-[#F4EDE4]/85 hover:text-[#E76F51] transition-colors">
                  About ImageLab
                </Link>
              </li>
              <li>
                <Link to="/profile" className="text-[#F4EDE4]/85 hover:text-[#E76F51] transition-colors">
                  Creator Profile
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-[#F4EDE4]/85 hover:text-[#E76F51] transition-colors">
                  Contact
                </Link>
              </li>
              <li>
                <Link to="/login" className="text-[#F4EDE4]/85 hover:text-[#E76F51] transition-colors">
                  Login
                </Link>
              </li>
              <li>
                <Link to="/signup" className="text-[#F4EDE4]/85 hover:text-[#E76F51] transition-colors">
                  Sign Up
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div className="lg:col-span-3 space-y-3">
            <h3 className="text-xs font-semibold tracking-wide text-[#F4EDE4]/55">
              Trust & Legal
            </h3>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link to="/privacy" className="text-[#F4EDE4]/85 hover:text-[#E76F51] transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="text-[#F4EDE4]/85 hover:text-[#E76F51] transition-colors">
                  Terms of Service
                </Link>
              </li>
            </ul>
            <p className="pt-2 text-xs text-[#F4EDE4]/60 leading-relaxed">
              Every prompt shared on ImageLab credits its creator and remains openly readable for learning and remixing.
            </p>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-[#FAF7F2]/12 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#F4EDE4]/60">
          <p>© {new Date().getFullYear()} ImageLab. Crafted for visual prompt explorers.</p>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="hover:text-[#F4EDE4] transition-colors">
              Privacy Policy
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/terms" className="hover:text-[#F4EDE4] transition-colors">
              Terms of Service
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/contact" className="hover:text-[#F4EDE4] transition-colors">
              Contact
            </Link>
            <span aria-hidden="true">·</span>
            <a href="/sitemap.xml" className="hover:text-[#F4EDE4] transition-colors">
              Sitemap
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
