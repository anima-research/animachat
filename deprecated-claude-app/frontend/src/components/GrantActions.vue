<template>
  <section class="mb-4">
    <h4 class="text-h6 mb-3">Actions</h4>
    <div class="d-flex flex-wrap" style="gap: 8px;">
      <v-btn v-if="canMint" color="primary" @click="open('mint')">Mint</v-btn>
      <v-btn v-if="canSend" color="primary" variant="outlined" @click="open('send')">Send</v-btn>
    </div>
    <v-alert v-if="message" :type="message.type" variant="tonal" class="mt-3">{{ message.text }}</v-alert>
  </section>
  <v-dialog v-model="dialogVisible" max-width="420">
    <v-card>
      <v-card-title class="text-h6">{{ dialogTitle }}</v-card-title>
      <v-card-text>
        <v-text-field v-model="forms[activeAction].email" :label="emailLabel" :color="statusColor(lookupStatus[activeAction])" :loading="lookupStatus[activeAction] === 'checking'" :messages="statusMessages(lookupStatus[activeAction])" variant="outlined" density="comfortable" autocomplete="email" />
        <v-text-field v-model.number="forms[activeAction].amount" label="Amount" type="number" min="0" step="0.01" variant="outlined" density="comfortable" />
        <v-textarea v-model="forms[activeAction].reason" label="Reason (optional)" rows="2" auto-grow variant="outlined" density="comfortable" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancel">Cancel</v-btn>
        <v-btn color="primary" :disabled="!canSubmit" :loading="submitting" @click="submit">{{ submitLabel }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api } from '@/services/api.js';
defineProps<{ canMint: boolean; canSend: boolean }>();
const emit = defineEmits<{ completed: [] }>();
type Action = 'mint'|'send';
type LookupStatus = 'idle'|'checking'|'valid'|'invalid';
const dialogVisible = ref(false), activeAction = ref<Action>('mint'), submitting = ref(false), message = ref<{ type: 'success'|'error'; text: string } | null>(null);
const forms = reactive<Record<Action, { email: string; amount: number; reason: string }>>({ mint: { email: '', amount: 0, reason: '' }, send: { email: '', amount: 0, reason: '' } });
const lookupStatus = reactive<Record<Action, LookupStatus>>({ mint: 'idle', send: 'idle' });
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
const canSubmit = computed(() => lookupStatus[activeAction.value] === 'valid' && forms[activeAction.value].amount > 0);
function statusColor(status: LookupStatus): string { return status === 'valid' ? 'success' : status === 'invalid' ? 'error' : ''; }
function statusMessages(status: LookupStatus): string[] { return status === 'valid' ? ['User found'] : status === 'invalid' ? ['User not found'] : []; }
function resetForm(action: Action) { forms[action].email = ''; forms[action].amount = 0; forms[action].reason = ''; lookupStatus[action] = 'idle'; }
function open(action: Action) { message.value = null; activeAction.value = action; resetForm(action); dialogVisible.value = true; }
function cancel() { resetForm(activeAction.value); dialogVisible.value = false; }
async function submit() {
  if (submitting.value || !dialogVisible.value) return;
  const action = activeAction.value, form = forms[action], email = form.email.trim(), amount = form.amount;
  submitting.value = true;
  message.value = null;
  try {
    await api.post(action === 'send' ? '/auth/grants/send' : '/auth/grants/mint', { email, amount, reason: form.reason.trim() || undefined });
    message.value = { type: 'success', text: action === 'send' ? `Sent ${amount} credits to ${email}` : `Minted ${amount} credits to ${email}` };
    resetForm(action);
    dialogVisible.value = false;
    emit('completed');
  } catch (error: any) {
    message.value = { type: 'error', text: error?.response?.data?.error || (action === 'send' ? 'Failed to send grant' : 'Failed to mint grant') };
  } finally {
    submitting.value = false;
  }
}
</script>
