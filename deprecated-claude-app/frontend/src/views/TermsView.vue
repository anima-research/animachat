<template>
  <div class="legal-container">
    <div class="breadcrumb">
      <a href="/anima/index.html">anima</a> / 
      <a href="/about">arc</a> /
      terms
    </div>
    
    <div class="content">
      <div class="header">
        <h1>TERMS OF SERVICE</h1>
        <p class="tagline">last updated: december 2024</p>
      </div>

      <div class="section" data-label="overview">
        <h2>◉ agreement overview</h2>
        <p>
          By accessing or using {{ siteConfig.branding.name }} ("the Service"), you agree to be bound by these Terms of Service. 
          If you do not agree to these terms, please do not use the Service.
        </p>
        <p>
          {{ siteConfig.branding.name }} is operated by {{ operator.name }} ("we", "us", "our"). The Service provides a platform for 
          AI-assisted conversations, multi-agent dialogues, and conversation management.
        </p>
      </div>

      <div class="section" data-label="experimental">
        <h2>◉ experimental nature</h2>
        <div class="highlight-box warning">
          <p>
            <strong>Arc Chat is experimental software.</strong> AI model outputs may be incorrect, 
            incomplete, biased, or inappropriate. You acknowledge and agree that:
          </p>
          <ul>
            <li>You will not rely on Arc Chat for medical, legal, financial, or emergency decisions</li>
            <li>AI responses do not constitute professional advice of any kind</li>
            <li>We make no guarantees about the accuracy, reliability, or appropriateness of AI outputs</li>
            <li>The Service may experience downtime, bugs, or unexpected behavior</li>
          </ul>
        </div>
      </div>

      <div class="section" data-label="account">
        <h2>◉ account & access</h2>
        <p>
          To use the Service, you must create an account. You agree to:
        </p>
        <ul>
          <li>Provide accurate and complete registration information</li>
          <li>Maintain the security of your account credentials</li>
          <li>Notify us immediately of any unauthorized access</li>
          <li>Accept responsibility for all activities under your account</li>
        </ul>
        <p>
          We reserve the right to suspend or terminate accounts that violate these terms or 
          our acceptable use policies.
        </p>
      </div>

      <div class="section" data-label="acceptable-use">
        <h2>◉ acceptable use</h2>
        <p>
          You agree not to use the Service to:
        </p>
        <ul>
          <li>Generate, distribute, or promote hate speech, harassment, or discriminatory content</li>
          <li>Create content that exploits, harms, or endangers minors</li>
          <li>Produce content that promotes violence, terrorism, or illegal activities</li>
          <li>Attempt to circumvent content moderation or safety systems</li>
          <li>Engage in any activity that violates applicable laws or regulations</li>
          <li>Interfere with or disrupt the Service or servers/networks connected to it</li>
          <li>Impersonate others or misrepresent your affiliation with any person or entity</li>
          <li>Use the Service for unauthorized commercial purposes</li>
        </ul>
        <p>
          Violations may result in immediate account suspension and potential legal action.
        </p>
      </div>

      <div class="section" data-label="content-moderation">
        <h2>◉ content moderation</h2>
        <p>
          We employ automated and manual content moderation to detect and prevent abuse. This includes:
        </p>
        <ul>
          <li>Transmission of prompts and outputs to third-party moderation services</li>
          <li>Automated filtering of content that violates our policies</li>
          <li>Review of flagged content by our team when necessary</li>
        </ul>
        <p>
          These systems are imperfect. If you believe content was incorrectly flagged, you may 
          contact us for review. Users requiring reduced moderation for legitimate research purposes 
          may apply for researcher access through our Discord.
        </p>
      </div>

      <div class="section" data-label="third-parties">
        <h2>◉ third-party services</h2>
        <p>
          The Service integrates with third-party AI model providers. By using the Service, you acknowledge:
        </p>
        <ul>
          <li>Your prompts and conversations are transmitted to the AI providers you select</li>
          <li>Each provider has their own terms of service and privacy policies</li>
          <li>We are not responsible for the conduct or policies of third-party providers</li>
          <li>Provider availability and model access may change without notice</li>
        </ul>
        <div class="provider-note">
          Current providers include: Anthropic, OpenAI, Google, Amazon Bedrock, OpenRouter, and others. 
          See the model selection interface for current availability.
        </div>
      </div>

      <div class="section" data-label="intellectual-property">
        <h2>◉ intellectual property</h2>
        <p>
          <strong>Your Content:</strong> You retain ownership of the content you create through the Service. 
          By using the Service, you grant us a limited license to store, process, and transmit your content 
          as necessary to provide the Service.
        </p>
        <p>
          <strong>AI-Generated Content:</strong> Ownership of AI-generated content is subject to the terms 
          of the AI providers used. We make no claims to ownership of AI outputs generated through our platform.
        </p>
        <p>
          <strong>Our Content:</strong> The Service, including its code, design, and documentation, 
          is open source where indicated. All other materials remain our intellectual property.
        </p>
      </div>

      <div class="section" data-label="shared-spaces">
        <h2>◉ shared spaces & collaboration</h2>
        <p>
          When participating in shared conversations or collaborative spaces:
        </p>
        <ul>
          <li>Messages you send are visible to other participants in that space</li>
          <li>You are responsible for content you share with others</li>
          <li>Do not share confidential or sensitive information in shared spaces</li>
          <li>Respect other participants and follow community guidelines</li>
        </ul>
      </div>

      <div class="section" data-label="liability">
        <h2>◉ limitation of liability</h2>
        <div class="highlight-box">
          <p>
            THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. TO THE MAXIMUM EXTENT 
            PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED.
          </p>
          <p>
            WE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR 
            PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE SERVICE.
          </p>
        </div>
      </div>

      <div class="section" data-label="termination">
        <h2>◉ termination</h2>
        <p>
          You may terminate your account at any time by contacting us. We may suspend or terminate 
          your access if you violate these terms or for any reason at our discretion.
        </p>
        <p>
          Upon termination, your right to use the Service ceases immediately. Data retention 
          follows our Privacy Notice.
        </p>
      </div>

      <div class="section" data-label="changes">
        <h2>◉ changes to terms</h2>
        <p>
          We may modify these terms at any time. Material changes will be communicated through 
          the Service or via email. Continued use after changes constitutes acceptance of the new terms.
        </p>
      </div>

      <div class="section" data-label="governing-law">
        <h2>◉ governing law</h2>
        <p>
          These terms are governed by the laws of the jurisdiction in which {{ operator.name }} operates. 
          Any disputes shall be resolved through binding arbitration or in the courts of that jurisdiction.
        </p>
      </div>

      <div class="section" data-label="contact">
        <h2>◉ contact</h2>
        <p>
          For questions about these terms or to report violations:
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
        <router-link to="/privacy" class="nav-link">Privacy Notice →</router-link>
        <router-link to="/login" class="nav-link secondary">← Back to Login</router-link>
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

.highlight-box.warning {
  background: rgba(212, 165, 116, 0.08);
  border-left-color: #d4a574;
}

.highlight-box p {
  margin-bottom: 10px;
}

.highlight-box ul {
  margin-bottom: 0;
}

.provider-note {
  font-size: 11px;
  color: #4a7c8e;
  background: rgba(8, 8, 12, 0.6);
  padding: 12px 15px;
  margin-top: 15px;
  border-radius: 3px;
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
  
  .navigation-footer {
    flex-direction: column;
    gap: 15px;
  }
  
  .nav-link {
    text-align: center;
  }
}
</style>



