<script setup>
import { computed, reactive, ref, watch } from 'vue';
import Cover from './Cover.vue';
import Icon from './Icon.vue';
import { api } from '../lib/api.js';
import { replaceArtwork } from '../lib/artwork.js';
import { useToast } from '../stores/toast.js';

const props = defineProps({
  track: { type: Object, required: true },
  score: { type: Number, default: null },
});
const emit = defineEmits(['change']);

const toast = useToast();
const picker = ref(null);
const addingGenre = ref(false);
const newGenre = ref('');
const coverKey = ref(0);
const form = reactive({ title: '', artist: '', album: '', year: '', genres: [] });

// ---------- Autocomplete ----------
const matches = ref(null);
const searching = ref(false);
const findingGenres = ref(false);
const picked = ref(null);
const failedCovers = ref(new Set());
const canSearch = computed(() => Boolean(form.title.trim() && form.artist.trim()));
const coverUrl = (match, size = 250) => `https://coverartarchive.org/release/${match.release_id}/front-${size}`;
const showCover = (match) => match.release_id && !failedCovers.value.has(match.release_id);

async function autocomplete() {
  searching.value = true;
  try {
    const found = await api.post('/admin/lookup', { title: form.title.trim(), artist: form.artist.trim() });
    if (found.matches.length) matches.value = found.matches;
    else toast.show('No matches. Check the spelling, or fill in the labels by hand.');
  } catch (error) {
    toast.error(error);
  } finally {
    searching.value = false;
  }
}

async function pick(match) {
  Object.assign(form, { title: match.title, artist: match.artist, album: match.album, year: match.year ?? '' });
  if (match.genres.length) form.genres = [...match.genres];
  picked.value = match;
  matches.value = null;

  // Curated genres are better than the search's tags, but take a moment.
  findingGenres.value = true;
  const found = await api
    .post('/admin/lookup/genres', {
      recording_id: match.recording_id,
      release_id: match.release_id,
      artist_id: match.artist_id,
    })
    .catch(() => ({ genres: [] }));
  // Ignore this answer if another match was picked in the meantime.
  if (picked.value?.recording_id === match.recording_id) {
    findingGenres.value = false;
    if (found.genres.length) form.genres = found.genres;
  }
}

watch(
  () => props.track,
  (track) => {
    Object.assign(form, {
      title: track.title,
      artist: track.artists?.[0]?.name ?? '',
      album: track.album?.title ?? '',
      year: track.album?.year ?? '',
      genres: [...(track.genres ?? [])],
    });
  },
  { immediate: true },
);

function addGenre() {
  const value = newGenre.value.trim();
  if (value && !form.genres.includes(value)) form.genres.push(value);
  newGenre.value = '';
  addingGenre.value = false;
}

async function chooseArtwork(file) {
  if (!file || !props.track.album) return;
  try {
    await replaceArtwork(props.track.album.id, file);
    coverKey.value += 1;
    toast.show('Artwork replaced');
    emit('change');
  } catch (error) {
    toast.error(error);
  }
}

/** Only what changed. Rewriting everything would drop featured artists. */
function changes() {
  const before = {
    title: props.track.title,
    artist: props.track.artists?.[0]?.name ?? '',
    album: props.track.album?.title ?? '',
    year: String(props.track.album?.year ?? ''),
  };
  const result = {};
  for (const key of ['title', 'artist', 'album']) {
    if (form[key].trim() !== before[key]) result[key] = form[key].trim();
  }
  if (String(form.year).trim() !== before.year) {
    result.year = String(form.year).trim() === '' ? null : Number(form.year);
  }
  if ([...form.genres].sort().join('|') !== [...(props.track.genres ?? [])].sort().join('|')) {
    result.genres = [...form.genres];
  }
  // A picked match links the song, its artist and its album to MusicBrainz.
  if (picked.value) {
    result.mb_recording_id = picked.value.recording_id;
    if (picked.value.artist_id && form.artist.trim() === picked.value.artist) {
      result.artist = form.artist.trim();
      result.mb_artist_id = picked.value.artist_id;
    }
    if (picked.value.release_id && form.album.trim() === picked.value.album) {
      result.album = form.album.trim();
      result.mb_release_id = picked.value.release_id;
    }
  }
  return result;
}

/** The release whose cover to apply after saving, if a match was picked. */
const coverRelease = () => {
  const match = picked.value;
  return match?.release_id && form.album.trim() === match.album ? match.release_id : null;
};

defineExpose({ changes, coverRelease });
</script>

<template>
  <div class="stack">
    <div class="row">
      <img v-if="picked && showCover(picked)" :src="coverUrl(picked)" alt="" width="120" height="120" style="border-radius: 8px; object-fit: cover" @error="failedCovers.add(picked.release_id)" />
      <Cover v-else :key="coverKey" :px="120" :cover="track.album?.cover" :seed="track.album?.id ?? track.id" />
      <div class="stack" style="gap: 8px">
        <input ref="picker" type="file" accept="image/*" hidden @change="chooseArtwork($event.target.files[0]); $event.target.value = ''" />
        <button class="btn outline small" :disabled="!track.album" @click="picker.click()">Replace artwork</button>
        <span class="muted label">{{ track.album?.cover ? 'From Cover Art Archive or the file' : 'No artwork yet' }}</span>
      </div>
    </div>
    <div v-if="score !== null && score < 0.9" class="notice">
      <Icon name="warning" /> Match {{ Math.round(score * 100) }}% — labels filled in automatically
    </div>
    <label class="field"><span>Title</span><input v-model="form.title" class="input" maxlength="255" /></label>
    <label class="field"><span>Artist</span><input v-model="form.artist" class="input" maxlength="255" /></label>
    <button type="button" class="btn outline block" :disabled="!canSearch || searching" @click="autocomplete">
      <Icon name="search" :size="20" /> {{ searching ? 'Searching…' : 'Autocomplete album, year, genres and artwork' }}
    </button>
    <label class="field"><span>Album</span><input v-model="form.album" class="input" maxlength="255" /></label>
    <label class="field"><span>Year</span><input v-model="form.year" class="input" inputmode="numeric" maxlength="4" /></label>
    <div class="field">
      <span>Genres<template v-if="findingGenres"> · finding genres…</template></span>
      <div class="row wrap">
        <span v-for="genre in form.genres" :key="genre" class="badge plain" style="min-height: 36px">
          {{ genre }}
          <button :aria-label="`Remove ${genre}`" @click="form.genres = form.genres.filter((item) => item !== genre)"><Icon name="close" :size="16" /></button>
        </span>
        <form v-if="addingGenre" class="row" @submit.prevent="addGenre">
          <input v-model="newGenre" class="input" style="width: 160px" placeholder="Genre" maxlength="100" aria-label="New genre" />
          <button class="btn small outline">Add</button>
        </form>
        <button v-else class="badge" style="min-height: 36px; border-style: dashed" @click="addingGenre = true">+ Add genre</button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="matches" class="scrim" @click.self="matches = null">
        <div class="sheet" role="dialog" aria-label="Choose a match">
          <div class="heading">Choose a match</div>
          <p class="muted label">From MusicBrainz. Nothing is saved until you save or approve.</p>
          <button v-for="match in matches" :key="match.recording_id" class="sheet-action" style="padding: 6px 0" @click="pick(match)">
            <img v-if="showCover(match)" :src="coverUrl(match)" alt="" width="56" height="56" loading="lazy" style="border-radius: 8px; object-fit: cover; flex: none" @error="failedCovers.add(match.release_id)" />
            <span v-else class="avatar" style="width: 56px; height: 56px; border-radius: 8px"><Icon name="music" /></span>
            <span class="grow">
              <span class="truncate" style="display: block; font-weight: 600">{{ match.title }}</span>
              <span class="truncate muted label" style="display: block">{{ match.artist }}<template v-if="match.album"> · {{ match.album }}</template><template v-if="match.year"> · {{ match.year }}</template></span>
            </span>
          </button>
          <button class="btn outline block" @click="matches = null">None of these</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
