<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import SignOutButton from '../components/SignOutButton.vue';
import * as dataSaver from '../lib/dataSaver.js';
import { lastReading } from '../lib/viewportGap.js';
import { formatLabel, losslessEnabled, readUsage, setLossless, streamFormat } from '../lib/streamFormat.js';
import { useSession } from '../stores/session.js';

const session = useSession();
const router = useRouter();
const lossless = ref(losslessEnabled());
const format = streamFormat();
const usage = readUsage();
// Installed iPhone app only: what iOS reports, for fixing layout problems.
const screenCheck = navigator.standalone === true ? { ...lastReading } : null;

const total = computed(() => usage.streaming + usage.offline);
const percent = computed(() => (total.value ? (usage.streaming / total.value) * 100 : 0));

function toggleLossless() {
  lossless.value = !lossless.value;
  setLossless(lossless.value);
}
</script>

<template>
  <header class="page-head" style="justify-content: flex-start">
    <button class="icon-btn back hide-big" style="margin: 0 0 0 -10px" aria-label="Back" @click="router.back()"><Icon name="back" /></button>
    <h1 class="display">Settings</h1>
  </header>
  <div class="stack" style="max-width: 720px">
    <div class="card row">
      <span class="avatar title" style="width: 72px; height: 72px">{{ session.user?.display_name?.charAt(0)?.toUpperCase() }}</span>
      <div class="grow">
        <div class="heading truncate">{{ session.user?.display_name }}</div>
        <div class="muted">{{ session.isAdmin ? 'Admin' : 'Member' }} · signed in</div>
      </div>
    </div>

    <h2 class="overline">Playback</h2>
    <div class="list-card">
      <div class="row spread" style="padding: 16px">
        <div class="grow">
          <div>Streaming format</div>
          <div class="muted label">Chosen automatically for this device</div>
        </div>
        <span class="muted">{{ formatLabel(format) }}</span>
      </div>
      <div class="row spread" style="padding: 16px">
        <div class="grow">
          <div>Lossless (FLAC)</div>
          <div class="muted label">Uses far more data. Turn on only when you're on Wi-Fi.</div>
        </div>
        <button class="switch" role="switch" :aria-checked="lossless" aria-label="Lossless" @click="toggleLossless"><i /></button>
      </div>
      <div class="row spread" style="padding: 16px">
        <div class="grow">
          <div>Save mobile data</div>
          <div class="muted label">
            {{ dataSaver.canDetect ? 'Plays only saved songs when on mobile data. Wi-Fi streams as normal.' : 'Plays only saved songs while this is on. Turn it off on Wi-Fi to stream.' }}
          </div>
        </div>
        <button class="switch" role="switch" :aria-checked="dataSaver.enabled.value" aria-label="Save mobile data" @click="dataSaver.toggle()"><i /></button>
      </div>
    </div>

    <h2 class="overline">Data usage</h2>
    <div class="card stack" style="gap: 12px">
      <div class="row spread">
        <span class="heading" style="font-weight: 500">This month</span>
        <span class="title">≈ {{ Math.round(total) }} MB</span>
      </div>
      <div class="bar" style="background: var(--text-muted)"><i :style="{ width: `${percent}%` }" /></div>
      <div class="row wrap label muted">
        <span>Streaming {{ Math.round(usage.streaming) }} MB</span>
        <span>Offline saves {{ Math.round(usage.offline) }} MB</span>
      </div>
      <p class="muted label">Estimated from bitrate and time played on this device.</p>
    </div>

    <h2 class="overline">Offline</h2>
    <RouterLink to="/offline" class="card row spread">
      <div class="grow">
        <div>Saved songs last 5 days</div>
        <div class="muted label">Renew any time to reset the timer</div>
      </div>
      <span class="accent" style="font-weight: 600">Manage</span>
    </RouterLink>

    <div style="margin-top: 16px"><SignOutButton button-class="btn danger-outline block" /></div>
    <p v-if="screenCheck" class="caption muted" style="text-align: center">
      Screen check: {{ screenCheck.fullHeight }} / {{ screenCheck.innerHeight }} / {{ Math.round(screenCheck.safeTop) }} / {{ screenCheck.gap }}
    </p>
  </div>
</template>
