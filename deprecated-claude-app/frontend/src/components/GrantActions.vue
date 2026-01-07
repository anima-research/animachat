<template>
  <section class="mb-4">
    <h4 class="text-h6 mb-3">Actions</h4>
    <div class="d-flex flex-wrap" style="gap: 8px;">
      <v-btn v-if="props.canMint" color="primary" @click="open('mint')">Mint</v-btn>
      <v-btn v-if="props.canSend" color="primary" variant="outlined" @click="open('send')">Send</v-btn>
      <v-btn v-if="props.canMint" color="primary" variant="outlined" @click="openInvite">Invite</v-btn>
    </div>
    <v-alert v-if="message" :type="message.type" variant="tonal" class="mt-3">{{ message.text }}</v-alert>
    
    <!-- My Invites List -->
    <div v-if="props.canMint && myInvites.length > 0" class="mt-4">
      <div 
        class="d-flex align-center justify-space-between" 
        style="cursor: pointer; user-select: none;"
        @click="showInvitesList = !showInvitesList"
      >
        <span class="text-subtitle-2 text-grey">My Invites ({{ myInvites.length }})</span>
        <v-icon size="small">{{ showInvitesList ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
      </div>
      <v-expand-transition>
        <div v-show="showInvitesList">
          <v-list density="compact" class="mt-2" style="background: transparent;">
            <v-list-item v-for="invite in myInvites" :key="invite.code" class="px-0">
              <template #prepend>
                <v-icon 
                  size="small" 
                  :color="inviteStatusColor(invite)"
                  class="mr-2"
                >
                  {{ inviteStatusIcon(invite) }}
                </v-icon>
              </template>
              <v-list-item-title class="text-body-2">
                <code style="font-size: 12px;">{{ invite.code }}</code>
                <span class="text-grey ml-2">{{ invite.amount }} {{ invite.currency === 'credit' ? 'cr' : invite.currency }}</span>
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                <span v-if="isFullyUsed(invite)">
                  Fully used ({{ invite.useCount }}/{{ invite.maxUses }})
                </span>
                <span v-else-if="isExpired(invite)">
                  Expired {{ formatDate(invite.expiresAt!) }}
                </span>
                <span v-else>
                  <span v-if="invite.maxUses">{{ invite.useCount ?? 0 }}/{{ invite.maxUses }} uses</span>
                  <span v-else-if="(invite.useCount ?? 0) > 0">{{ invite.useCount }} uses (unlimited)</span>
                  <span v-else>Pending (unlimited)</span>
                  <span v-if="invite.expiresAt"> · expires {{ formatDate(invite.expiresAt) }}</span>
                </span>
              </v-list-item-subtitle>
              <template #append>
                <v-btn 
                  v-if="!isFullyUsed(invite) && !isExpired(invite)"
                  size="x-small" 
                  variant="text" 
                  @click.stop="copyInviteLink(invite.code)"
                >
                  {{ copiedCode === invite.code ? '✓' : 'Copy' }}
                </v-btn>
              </template>
            </v-list-item>
          </v-list>
        </div>
      </v-expand-transition>
    </div>
  </section>
  
  <!-- Mint/Send Dialog -->
  <v-dialog v-model="dialogVisible" max-width="420">
    <v-card>
      <v-card-title class="text-h6">{{ dialogTitle }}</v-card-title>
      <v-card-text>
        <v-text-field v-model="forms[activeAction].email" :label="emailLabel" :color="statusColor(lookupStatus[activeAction])" :loading="lookupStatus[activeAction] === 'checking'" :messages="statusMessages(lookupStatus[activeAction])" variant="outlined" density="comfortable" autocomplete="email" :disabled="!!forms[activeAction].code.trim()" />
        
        <!-- Code field for Mint only -->
        <template v-if="activeAction === 'mint'">
          <div class="text-caption text-grey text-center my-2">— or generate a code —</div>
          <v-text-field v-model="forms[activeAction].code" label="Code (claimable)" placeholder="leave empty to mint directly" variant="outlined" density="comfortable" :disabled="!!forms[activeAction].email.trim()" />
        </template>
        
        <v-text-field v-model.number="forms[activeAction].amount" label="Amount" type="number" min="0" step="0.01" variant="outlined" density="comfortable" />
        <v-select
          v-model="forms[activeAction].currency"
          :items="currencyOptions"
          item-title="title"
          item-value="value"
          label="Credit type"
          variant="outlined"
          density="comfortable"
        />
        <v-textarea v-model="forms[activeAction].reason" label="Reason (optional)" rows="2" auto-grow variant="outlined" density="comfortable" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancel">Cancel</v-btn>
        <v-btn color="primary" :disabled="!canSubmit" :loading="submitting" @click="submit">{{ submitLabel }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  
  <!-- Invite Dialog -->
  <v-dialog v-model="inviteDialogVisible" max-width="420">
    <v-card>
      <v-card-title class="text-h6">Create Invite</v-card-title>
      <v-card-text>
        <v-text-field v-model.number="inviteForm.amount" label="Credit Amount" type="number" min="1" step="1" variant="outlined" density="comfortable" />
        <v-select
          v-model="inviteForm.currency"
          :items="currencyOptions"
          item-title="title"
          item-value="value"
          label="Credit type"
          variant="outlined"
          density="comfortable"
        />
        <v-text-field v-model="inviteForm.code" label="Custom code (optional)" placeholder="auto-generated if empty" variant="outlined" density="comfortable" />
        <v-text-field v-model.number="inviteForm.maxUses" label="Max uses (optional)" type="number" min="1" placeholder="unlimited" variant="outlined" density="comfortable" hint="Leave empty for unlimited uses" persistent-hint />
        <v-text-field v-model.number="inviteForm.expiresInDays" label="Expires in days (optional)" type="number" min="1" placeholder="no expiration" variant="outlined" density="comfortable" class="mt-2" />
        
        <!-- Success state: show generated invite -->
        <div v-if="createdInvite" class="invite-success mt-4">
          <v-alert type="success" variant="tonal" class="mb-3">
            Invite created!
          </v-alert>
          <div class="invite-code-display">
            <span class="code-label">Code:</span>
            <code class="invite-code">{{ createdInvite.code }}</code>
          </div>
          <div class="invite-link-display mt-2">
            <v-text-field
              :model-value="inviteLink"
              readonly
              variant="outlined"
              density="compact"
              hide-details
            >
              <template #append-inner>
                <v-btn size="small" variant="text" @click="copyLink">
                  {{ copied ? '✓' : 'Copy' }}
                </v-btn>
              </template>
            </v-text-field>
          </div>
          <div class="invite-details mt-2 text-caption text-grey">
            {{ createdInvite.amount }} {{ createdInvite.currency === 'credit' ? 'credits' : createdInvite.currency }}
            <span v-if="createdInvite.maxUses"> · {{ createdInvite.maxUses }} uses max</span>
            <span v-else> · unlimited uses</span>
            <span v-if="createdInvite.expiresAt"> · expires {{ formatDate(createdInvite.expiresAt) }}</span>
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="closeInvite">{{ createdInvite ? 'Done' : 'Cancel' }}</v-btn>
        <v-btn v-if="!createdInvite" color="primary" :disabled="inviteForm.amount <= 0" :loading="inviteSubmitting" @click="submitInvite">Create</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { computed, reactive, ref, watch, onMounted } from 'vue';
import { api } from '@/services/api.js';
const props = defineProps<{ canMint: boolean; canSend: boolean; currencies: string[] }>();
const emit = defineEmits<{ completed: [] }>();
type Action = 'mint'|'send';

// My invites list
interface Invite {
  code: string;
  amount: number;
  currency: string;
  createdAt: string;
  expiresAt?: string;
  maxUses?: number; // undefined = unlimited
  useCount: number;
  claimedBy?: string; // legacy: last claimer
  claimedAt?: string;
}
const myInvites = ref<Invite[]>([]);
const showInvitesList = ref(false);
const copiedCode = ref<string | null>(null);

async function loadMyInvites() {
  if (!props.canMint) return;
  try {
    const response = await api.get('/invites');
    myInvites.value = response.data.sort((a: Invite, b: Invite) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch (e) {
    console.error('Failed to load invites:', e);
  }
}

function inviteStatusColor(invite: Invite): string {
  const useCount = invite.useCount ?? 0;
  const isFullyUsed = invite.maxUses !== undefined && useCount >= invite.maxUses;
  if (isFullyUsed) return 'success';
  if (isExpired(invite)) return 'grey';
  if (useCount > 0) return 'info'; // Partially used
  return 'warning'; // Unused
}

function inviteStatusIcon(invite: Invite): string {
  const useCount = invite.useCount ?? 0;
  const isFullyUsed = invite.maxUses !== undefined && useCount >= invite.maxUses;
  if (isFullyUsed) return 'mdi-check-circle';
  if (isExpired(invite)) return 'mdi-clock-alert-outline';
  if (useCount > 0) return 'mdi-checkbox-marked-circle-outline'; // Partially used
  return 'mdi-clock-outline';
}

function isFullyUsed(invite: Invite): boolean {
  const useCount = invite.useCount ?? 0;
  return invite.maxUses !== undefined && useCount >= invite.maxUses;
}

function isExpired(invite: Invite): boolean {
  if (!invite.expiresAt) return false;
  return new Date(invite.expiresAt) < new Date();
}

async function copyInviteLink(code: string) {
  const link = `${window.location.origin}/login?invite=${encodeURIComponent(code)}`;
  try {
    await navigator.clipboard.writeText(link);
    copiedCode.value = code;
    setTimeout(() => { copiedCode.value = null; }, 2000);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = link;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    copiedCode.value = code;
    setTimeout(() => { copiedCode.value = null; }, 2000);
  }
}

onMounted(() => {
  loadMyInvites();
});

watch(() => props.canMint, (canMint) => {
  if (canMint) loadMyInvites();
});
type LookupStatus = 'idle'|'checking'|'valid'|'invalid';
type FormState = { email: string; amount: number; reason: string; currency: string; code: string };
const actions: Action[] = ['mint', 'send'];
const dialogVisible = ref(false), activeAction = ref<Action>('mint'), submitting = ref(false), message = ref<{ type: 'success'|'error'; text: string } | null>(null);
const mintCodeResult = ref<{ code: string; link: string } | null>(null);
const currencyOptions = computed(() => {
  const raw = Array.isArray(props.currencies) ? props.currencies : [];
  const unique = Array.from(new Set(['credit', ...raw]))
    .map(currency => (typeof currency === 'string' ? currency.trim() : ''))
    .filter(Boolean);
  return unique.map(currency => ({ title: currency === 'credit' ? 'Credits' : currency, value: currency }));
});
function defaultCurrency(): string {
  return currencyOptions.value[0]?.value || 'credit';
}
const forms = reactive<Record<Action, FormState>>({
  mint: { email: '', amount: 0, reason: '', currency: defaultCurrency(), code: '' },
  send: { email: '', amount: 0, reason: '', currency: defaultCurrency(), code: '' }
});
const lookupStatus = reactive<Record<Action, LookupStatus>>({ mint: 'idle', send: 'idle' });
watch(currencyOptions, options => {
  const fallback = options[0]?.value || 'credit';
  for (const action of actions) {
    if (!options.find(option => option.value === forms[action].currency)) {
      forms[action].currency = fallback;
    }
  }
}, { immediate: true });
function useEmailLookup(action: Action) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let token = 0;
  watch(() => forms[action].email, value => {
    if (timer) clearTimeout(timer);
    const email = value.trim();
    if (!email) { lookupStatus[action] = 'idle'; return; }
    lookupStatus[action] = 'checking';
    const current = ++token;
    timer = setTimeout(async () => {
      try {
        const response = await api.get('/auth/users/lookup', { params: { email } });
        if (current !== token) return;
        lookupStatus[action] = response.data.exists ? 'valid' : 'invalid';
      } catch {
        if (current !== token) return;
        lookupStatus[action] = 'invalid';
      }
    }, 250);
  });
}
useEmailLookup('mint');useEmailLookup('send');
const dialogTitle = computed(() => activeAction.value === 'send' ? 'Send grant' : 'Mint grant');
const emailLabel = computed(() => activeAction.value === 'send' ? 'Receiver email' : 'Recipient email');
const submitLabel = computed(() => activeAction.value === 'send' ? 'Send' : 'Mint');
const canSubmit = computed(() => {
  const form = forms[activeAction.value];
  const hasAmount = form.amount > 0 && !!form.currency;
  if (activeAction.value === 'mint') {
    // For mint: either valid email OR code provided
    const hasValidEmail = lookupStatus[activeAction.value] === 'valid';
    const hasCode = !!form.code.trim();
    return hasAmount && (hasValidEmail || hasCode);
  }
  // For send: require valid email
  return hasAmount && lookupStatus[activeAction.value] === 'valid';
});
function statusColor(status: LookupStatus): string { return status === 'valid' ? 'success' : status === 'invalid' ? 'error' : ''; }
function statusMessages(status: LookupStatus): string[] { return status === 'valid' ? ['User found'] : status === 'invalid' ? ['User not found'] : []; }
function resetForm(action: Action) { forms[action].email = ''; forms[action].amount = 0; forms[action].reason = ''; forms[action].currency = defaultCurrency(); forms[action].code = ''; lookupStatus[action] = 'idle'; mintCodeResult.value = null; }
function open(action: Action) { message.value = null; activeAction.value = action; resetForm(action); dialogVisible.value = true; }
function cancel() { resetForm(activeAction.value); dialogVisible.value = false; }
async function submit() {
  if (submitting.value || !dialogVisible.value) return;
  const action = activeAction.value, form = forms[action], email = form.email.trim(), code = form.code.trim(), amount = form.amount;
  submitting.value = true;
  message.value = null;
  
  try {
    // If mint with code (no email), create a claimable code instead
    if (action === 'mint' && code && !email) {
      const payload: any = { amount, currency: form.currency };
      if (code) payload.code = code;
      const response = await api.post('/invites', payload);
      const createdCode = response.data.code;
      const link = `${window.location.origin}/login?invite=${encodeURIComponent(createdCode)}`;
      mintCodeResult.value = { code: createdCode, link };
      const currencyLabel = form.currency === 'credit' ? 'credits' : `${form.currency} credits`;
      message.value = { type: 'success', text: `Created code "${createdCode}" for ${amount} ${currencyLabel}` };
      loadMyInvites();
    } else {
      // Direct mint/send to email
      await api.post(action === 'send' ? '/auth/grants/send' : '/auth/grants/mint', { email, amount, reason: form.reason.trim() || undefined, currency: form.currency });
      const currencyLabel = form.currency === 'credit' ? 'credits' : `${form.currency} credits`;
      message.value = { type: 'success', text: action === 'send' ? `Sent ${amount} ${currencyLabel} to ${email}` : `Minted ${amount} ${currencyLabel} to ${email}` };
    }
    resetForm(action);
    dialogVisible.value = false;
    emit('completed');
  } catch (error: any) {
    message.value = { type: 'error', text: error?.response?.data?.error || (action === 'send' ? 'Failed to send grant' : 'Failed to mint grant') };
  } finally {
    submitting.value = false;
  }
}

// Invite functionality
interface CreatedInvite { code: string; amount: number; currency: string; expiresAt?: string; maxUses?: number; useCount: number }
const inviteDialogVisible = ref(false);
const inviteSubmitting = ref(false);
const createdInvite = ref<CreatedInvite | null>(null);
const copied = ref(false);
const inviteForm = reactive({
  amount: 100,
  currency: defaultCurrency(),
  code: '',
  expiresInDays: 30,
  maxUses: null as number | null // null = unlimited
});

const inviteLink = computed(() => {
  if (!createdInvite.value) return '';
  const base = window.location.origin;
  return `${base}/login?invite=${encodeURIComponent(createdInvite.value.code)}`;
});

function openInvite() {
  message.value = null;
  createdInvite.value = null;
  copied.value = false;
  inviteForm.amount = 100;
  inviteForm.currency = defaultCurrency();
  inviteForm.code = '';
  inviteForm.expiresInDays = 30;
  inviteForm.maxUses = null;
  inviteDialogVisible.value = true;
}

function closeInvite() {
  inviteDialogVisible.value = false;
  if (createdInvite.value) {
    loadMyInvites(); // Refresh the invites list
    emit('completed');
  }
}

async function submitInvite() {
  if (inviteSubmitting.value) return;
  inviteSubmitting.value = true;
  try {
    const payload: any = {
      amount: inviteForm.amount,
      currency: inviteForm.currency
    };
    if (inviteForm.code.trim()) payload.code = inviteForm.code.trim();
    if (inviteForm.expiresInDays > 0) payload.expiresInDays = inviteForm.expiresInDays;
    if (inviteForm.maxUses !== null && inviteForm.maxUses > 0) payload.maxUses = inviteForm.maxUses;
    // Note: if maxUses is null/undefined, the invite has unlimited uses
    
    const response = await api.post('/invites', payload);
    createdInvite.value = response.data;
  } catch (error: any) {
    message.value = { type: 'error', text: error?.response?.data?.error || 'Failed to create invite' };
    inviteDialogVisible.value = false;
  } finally {
    inviteSubmitting.value = false;
  }
}

async function copyLink() {
  if (!inviteLink.value) return;
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = inviteLink.value;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString();
}
</script>
