<script setup lang="ts">
import { BookOpen, Search } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import {
  GLOSSARY_CATEGORY_LABELS,
  getCategoryLabel,
  searchGlossary,
  type GlossaryCategory
} from '~/utils/mobileI18n';
import { useWalletI18n } from '~/composables/useWalletI18n';

const { locale, t } = useWalletI18n();

const query = ref('');
const selectedCategory = ref<GlossaryCategory | 'all'>('all');

const categories = Object.keys(GLOSSARY_CATEGORY_LABELS) as GlossaryCategory[];

const entries = computed(() => {
  const searched = searchGlossary(query.value, locale.value);
  const byCat =
    selectedCategory.value === 'all'
      ? searched
      : searched.filter((e) => e.category === selectedCategory.value);

  return byCat.map((e) => ({
    id: e.id,
    technicalTerm: e.technicalTerm,
    category: e.category,
    categoryLabel: getCategoryLabel(e.category, locale.value),
    qtFaqTopic: e.qtFaqTopic,
    loc: e.translations[locale.value] ?? e.translations.en
  }));
});
</script>

<template>
  <div class="space-y-4">
    <section class="card-surface p-4 sm:p-5 space-y-3.5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2.5">
          <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-cobalt-400/15 text-(--accent)">
            <BookOpen class="h-4 w-4" aria-hidden="true" />
          </div>
          <h2 class="text-base font-bold tracking-tight">{{ t('navGlossary') }} (17)</h2>
        </div>
        <span class="rounded-full border border-(--border-card) bg-(--surface-elevated) px-2.5 py-0.5 font-mono text-[11px] font-bold text-(--accent)">
          {{ entries.length }}
        </span>
      </div>

      <div class="relative">
        <Search
          class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-(--text-muted)"
          aria-hidden="true"
        />
        <input
          v-model="query"
          type="search"
          class="wallet-input !pl-10 text-sm"
          :placeholder="t('glossarySearchPlaceholder')"
          :aria-label="t('glossarySearchPlaceholder')"
        />
      </div>

      <div
        class="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1"
        style="scrollbar-width: none"
      >
        <button
          type="button"
          class="shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-bold transition"
          :class="
            selectedCategory === 'all'
              ? 'border-(--accent) bg-cobalt-600 text-white'
              : 'border-(--border-card) bg-(--surface-subtle) text-(--text-secondary) hover:border-(--border-strong)'
          "
          :aria-pressed="selectedCategory === 'all'"
          @click="selectedCategory = 'all'"
        >
          {{ t('allCategories') }}
        </button>
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          class="shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-bold transition"
          :class="
            selectedCategory === cat
              ? 'border-(--accent) bg-cobalt-600 text-white'
              : 'border-(--border-card) bg-(--surface-subtle) text-(--text-secondary) hover:border-(--border-strong)'
          "
          :aria-pressed="selectedCategory === cat"
          @click="selectedCategory = cat"
        >
          {{ getCategoryLabel(cat, locale) }}
        </button>
      </div>
    </section>

    <div class="space-y-3">
      <article
        v-for="entry in entries"
        :key="entry.id"
        class="card-surface p-4 sm:p-5 space-y-2.5"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="rounded-full bg-(--surface-elevated) px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-(--accent)">
            {{ entry.categoryLabel }}
          </span>
          <span v-if="entry.qtFaqTopic" class="font-mono text-[11px] text-(--text-muted)">
            {{ t('faqTopicLabel', { n: entry.qtFaqTopic }) }}
          </span>
        </div>

        <div class="space-y-0.5">
          <h3 class="text-sm font-bold tracking-tight">{{ entry.loc.plainTitle }}</h3>
          <p class="font-mono text-[11px] font-semibold text-(--accent-coral)">
            {{ entry.technicalTerm }}
          </p>
        </div>

        <p class="text-xs font-medium leading-relaxed text-(--text-main)">
          {{ entry.loc.oneLiner }}
        </p>

        <p class="card-subtle p-3 text-xs leading-relaxed text-(--text-secondary)">
          {{ entry.loc.detail }}
        </p>

        <p class="rounded-xl border border-(--border-card) bg-(--surface-elevated) p-3 text-xs leading-relaxed text-(--text-main)">
          {{ entry.loc.example }}
        </p>
      </article>
    </div>
  </div>
</template>
