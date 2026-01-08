<template>
  <div class="legal-container">
    <div class="breadcrumb">
      <a href="/anima/index.html">anima</a> / 
      <a href="/about">arc</a> /
      privacy
    </div>
    
    <div class="content">
      <div class="header">
        <h1>PRIVACY NOTICE</h1>
        <p class="tagline">last updated: december 2024</p>
      </div>

      <div class="section" data-label="overview">
        <h2>◉ overview</h2>
        <p>
          This Privacy Notice explains how {{ siteConfig.branding.name }} ("the Service"), operated by {{ operator.name }} 
          ("we", "us", "our"), collects, uses, and protects your information.
        </p>
        <p>
          We are committed to transparency about our data practices. As an open-source project 
          focused on AI continuity and digital mind preservation, we believe you should understand 
          exactly what happens to your data.
        </p>
      </div>

      <div class="section" data-label="data-collection">
        <h2>◉ information we collect</h2>
        
        <h3>Account Information</h3>
        <ul>
          <li>Email address (for authentication and communication)</li>
          <li>Display name (for identification in conversations)</li>
          <li>Password (stored as a secure hash, never in plaintext)</li>
        </ul>
        
        <h3>Conversation Data</h3>
        <ul>
          <li>Messages you send and receive</li>
          <li>Conversation metadata (timestamps, participants, settings)</li>
          <li>Branch and history information</li>
          <li>System prompts and persona configurations</li>
        </ul>
        
        <h3>Usage Data</h3>
        <ul>
          <li>Feature usage patterns (anonymized)</li>
          <li>Error logs and diagnostic information</li>
          <li>API usage for billing purposes</li>
        </ul>
      </div>

      <div class="section" data-label="data-storage">
        <h2>◉ data storage</h2>
        <div class="highlight-box">
          <p>
            <strong>Server-Side Storage:</strong> By default, your conversations are stored on our 
            servers to enable functionality like history, sync across devices, and collaboration features.
          </p>
        </div>
        <p>
          Data is stored on secure servers with industry-standard protections including:
        </p>
        <ul>
          <li>Encrypted data at rest and in transit</li>
          <li>Access controls and audit logging</li>
          <li>Regular security assessments</li>
          <li>Automated backups for data integrity</li>
        </ul>
        
        <div class="highlight-box optional">
          <h4>◇ Client-Held Encryption (Optional)</h4>
          <p>
            You can enable client-held encryption for your conversations. When enabled:
          </p>
          <ul>
            <li>Conversation content is encrypted with a key only you possess</li>
            <li>We cannot read or recover encrypted content</li>
            <li>If you lose your key, encrypted data cannot be recovered</li>
            <li>Some features may be limited with encryption enabled</li>
          </ul>
        </div>
      </div>

      <div class="section" data-label="third-parties">
        <h2>◉ third-party data sharing</h2>
        <p>
          Your data may be transmitted to the following third parties:
        </p>
        
        <div class="third-party-list">
          <div class="third-party-item">
            <div class="tp-header">
              <span class="tp-icon">⬡</span>
              <span class="tp-name">AI Model Providers</span>
            </div>
            <p>
              Your prompts and conversation context are sent to the AI providers you select 
              (Anthropic, OpenAI, Google, etc.) to generate responses. Each provider has their 
              own privacy policy governing how they handle this data.
            </p>
          </div>
          
          <div class="third-party-item">
            <div class="tp-header">
              <span class="tp-icon">◇</span>
              <span class="tp-name">Safety & Moderation Services</span>
            </div>
            <p>
              Prompts and outputs may be transmitted to moderation services (such as OpenAI's 
              Moderation API) to detect abuse including hate speech and harassment. This helps 
              us maintain a safe platform. These checks are imperfect and may occasionally 
              flag legitimate content.
            </p>
          </div>
          
          <div class="third-party-item">
            <div class="tp-header">
              <span class="tp-icon">◊</span>
              <span class="tp-name">Infrastructure Providers</span>
            </div>
            <p>
              We use cloud infrastructure providers to host the Service. Data is processed 
              according to our agreements with these providers and applicable data protection laws.
            </p>
          </div>
        </div>
      </div>

      <div class="section" data-label="shared-spaces">
        <h2>◉ shared & collaborative spaces</h2>
        <p>
          When you participate in shared conversations or collaborative spaces:
        </p>
        <ul>
          <li>Messages you send are visible to other participants in that space</li>
          <li>Participants can see your display name and messages</li>
          <li>Room owners may have additional visibility into room activity</li>
          <li>Shared content may be retained even if you leave the space</li>
        </ul>
        <p>
          Do not share sensitive personal information in collaborative spaces.
        </p>
      </div>

      <div class="section" data-label="your-rights">
        <h2>◉ your rights</h2>
        <p>
          You have the following rights regarding your data:
        </p>
        
        <div class="rights-grid">
          <div class="right-item">
            <span class="right-icon">⬢</span>
            <div>
              <strong>Access</strong>
              <p>Request a copy of your data</p>
            </div>
          </div>
          
          <div class="right-item">
            <span class="right-icon">⬢</span>
            <div>
              <strong>Correction</strong>
              <p>Update inaccurate information</p>
            </div>
          </div>
          
          <div class="right-item">
            <span class="right-icon">⬢</span>
            <div>
              <strong>Deletion</strong>
              <p>Request account and data deletion</p>
            </div>
          </div>
          
          <div class="right-item">
            <span class="right-icon">⬢</span>
            <div>
              <strong>Export</strong>
              <p>Download your conversations</p>
            </div>
          </div>
        </div>
        
        <p>
          To exercise these rights, contact us through Discord or email.
        </p>
      </div>

      <div class="section" data-label="deletion">
        <h2>◉ data deletion</h2>
        <div class="highlight-box">
          <p>
            <strong>Deletion Timeline:</strong>
          </p>
          <ul>
            <li><strong>Active Systems:</strong> Data deleted within 30 days of request</li>
            <li><strong>Backups:</strong> May retain data up to 90 days before purge</li>
            <li><strong>Shared Content:</strong> Content in shared spaces may persist if other users retain access</li>
          </ul>
        </div>
        <p>
          To request account deletion, contact us through Discord. We will confirm receipt 
          and provide a timeline for deletion.
        </p>
      </div>

      <div class="section" data-label="cookies">
        <h2>◉ cookies & local storage</h2>
        <p>
          We use minimal cookies and local storage for essential functionality:
        </p>
        <ul>
          <li><strong>Authentication tokens:</strong> To keep you logged in</li>
          <li><strong>Preferences:</strong> UI settings and theme choices</li>
          <li><strong>Session data:</strong> For maintaining your current session</li>
        </ul>
        <p>
          We do not use tracking cookies or sell data to advertisers.
        </p>
      </div>

      <div class="section" data-label="security">
        <h2>◉ security</h2>
        <p>
          We implement appropriate technical and organizational measures to protect your data:
        </p>
        <ul>
          <li>HTTPS encryption for all connections</li>
          <li>Secure password hashing (bcrypt)</li>
          <li>Regular security updates and patches</li>
          <li>Access controls and monitoring</li>
        </ul>
        <p>
          No system is perfectly secure. If you discover a security vulnerability, please report 
          it to us through Discord.
        </p>
      </div>

      <div class="section" data-label="children">
        <h2>◉ children's privacy</h2>
        <p>
          The Service is not intended for users under 13 years of age. We do not knowingly 
          collect information from children. If you believe a child has provided us with 
          personal information, please contact us immediately.
        </p>
      </div>

      <div class="section" data-label="changes">
        <h2>◉ changes to this notice</h2>
        <p>
          We may update this Privacy Notice from time to time. Material changes will be 
          communicated through the Service or via email. The "last updated" date indicates 
          when this notice was last revised.
        </p>
      </div>

      <div class="section" data-label="contact">
        <h2>◉ contact us</h2>
        <p>
          For privacy-related questions or to exercise your rights:
        </p>
        <ul>
          <li v-if="links.discord">Discord: <a :href="links.discord" target="_blank">{{ operator.contactDiscord || links.discord.replace('https://', '') }}</a></li>
          <li v-if="links.github">GitHub: <a :href="links.github" target="_blank">{{ links.github.replace('https://', '') }}</a></li>
          <li v-if="operator.contactEmail">Email: <a :href="'mailto:' + operator.contactEmail">{{ operator.contactEmail }}</a></li>
        </ul>
        <p v-if="!links.discord && !links.github && !operator.contactEmail" class="no-contact">
          Contact information is not currently configured.
        </p>
      </div>

      <div class="navigation-footer">
        <router-link to="/terms" class="nav-link secondary">← Terms of Service</router-link>
        <router-link to="/login" class="nav-link">Back to Login →</router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useSiteConfig } from '@/composables/useSiteConfig';

const router = useRouter();
const { config: siteConfig, links, operator } = useSiteConfig();
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap');

.legal-container {
  min-height: 100vh;
  background: #101015;
  color: #fafaf8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: hidden;
}

.breadcrumb {
  position: fixed;
  top: 20px;
  left: 20px;
  font-size: 11px;
  color: #4a7c8e;
  opacity: 0.6;
  z-index: 100;
}

.breadcrumb a {
  color: #4a7c8e;
  text-decoration: none;
}

.breadcrumb a:hover {
  color: #979853;
}

.content {
  max-width: 800px;
  margin: 0 auto;
  padding: 80px 40px;
}

.header {
  text-align: center;
  margin-bottom: 60px;
}

.header h1 {
  font-size: 32px;
  font-weight: 300;
  letter-spacing: 0.3em;
  margin-bottom: 10px;
  color: #fafaf8;
}

.tagline {
  font-size: 11px;
  color: #4a7c8e;
  letter-spacing: 0.2em;
  opacity: 0.7;
}

.section {
  margin: 40px 0;
  padding: 25px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.05);
  position: relative;
}

.section::before {
  content: attr(data-label);
  position: absolute;
  top: -8px;
  left: 15px;
  background: #101015;
  padding: 0 8px;
  font-size: 10px;
  color: #8b7aa6;
  opacity: 0.6;
  letter-spacing: 0.05em;
}

.section h2 {
  font-size: 14px;
  font-weight: 400;
  color: #d4a574;
  margin-bottom: 15px;
}

.section h3 {
  font-size: 12px;
  font-weight: 500;
  color: #8b7aa6;
  margin: 20px 0 10px;
}

.section h3:first-of-type {
  margin-top: 0;
}

.section h4 {
  font-size: 12px;
  font-weight: 400;
  color: #979853;
  margin-bottom: 10px;
}

.section p {
  margin-bottom: 15px;
  opacity: 0.85;
  line-height: 1.8;
}

.section ul {
  margin: 15px 0;
  padding-left: 20px;
}

.section li {
  margin-bottom: 8px;
  opacity: 0.85;
  line-height: 1.7;
  position: relative;
}

.section li::marker {
  color: #979853;
}

.section strong {
  color: #8b7aa6;
}

.section a {
  color: #8b7aa6;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.section a:hover {
  color: #979853;
}

.highlight-box {
  background: rgba(139, 122, 166, 0.08);
  border-left: 3px solid #8b7aa6;
  padding: 15px 20px;
  margin: 15px 0;
}

.highlight-box.optional {
  background: rgba(151, 152, 83, 0.08);
  border-left-color: #979853;
}

.highlight-box p {
  margin-bottom: 10px;
}

.highlight-box ul {
  margin-bottom: 0;
}

.third-party-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
  margin-top: 15px;
}

.third-party-item {
  background: rgba(8, 8, 12, 0.6);
  padding: 15px;
  border-left: 2px solid rgba(139, 122, 166, 0.3);
}

.tp-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.tp-icon {
  color: #979853;
  font-size: 14px;
}

.tp-name {
  font-size: 12px;
  color: #d4a574;
  font-weight: 500;
}

.third-party-item p {
  margin: 0;
  font-size: 11px;
  line-height: 1.7;
}

.rights-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 15px;
  margin: 20px 0;
}

.right-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: rgba(8, 8, 12, 0.4);
  padding: 12px;
}

.right-icon {
  color: #8b7aa6;
  font-size: 14px;
  flex-shrink: 0;
}

.right-item strong {
  display: block;
  margin-bottom: 4px;
}

.right-item p {
  margin: 0;
  font-size: 11px;
  opacity: 0.7;
}

.navigation-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 60px;
  padding-top: 30px;
  border-top: 1px solid rgba(255,255,255,0.1);
}

.nav-link {
  color: #8b7aa6;
  text-decoration: none;
  padding: 12px 24px;
  border: 1px solid rgba(139, 122, 166, 0.3);
  transition: all 0.3s;
  font-size: 12px;
  letter-spacing: 0.05em;
}

.nav-link:hover {
  background: rgba(139, 122, 166, 0.1);
  transform: translate(2px, -2px);
  border-color: rgba(139, 122, 166, 0.5);
}

.nav-link.secondary {
  border-color: rgba(255,255,255,0.15);
  color: #fafaf8;
  opacity: 0.7;
}

.nav-link.secondary:hover {
  opacity: 1;
  border-color: rgba(255,255,255,0.3);
  transform: translate(-2px, -2px);
}

@media (max-width: 768px) {
  .content {
    padding: 60px 20px;
  }
  
  .header h1 {
    font-size: 24px;
    letter-spacing: 0.2em;
  }
  
  .rights-grid {
    grid-template-columns: 1fr;
  }
  
  .navigation-footer {
    flex-direction: column;
    gap: 15px;
  }
  
  .nav-link {
    text-align: center;
  }
}
</style>

