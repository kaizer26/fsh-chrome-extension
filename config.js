/**
 * config.js — Konfigurasi terpusat FASIH Extensions
 */
const CONFIG = {
  // ── API ──────────────────────────────────────────────
  BASE: 'https://fasih-sm.bps.go.id',
  get API() { return this.BASE + '/app/api'; },

  get ASSIGN_URL() { return this.API + '/analytic/api/v2/assignment/report-progress-by-responsibility'; },
  get ASSIGN_DATATABLE() { return this.API + '/analytic/api/v2/assignment/datatable-all-user-survey-periode'; },
  get ASSIGN_DETAIL() { return this.API + '/assignment-general/api/assignment/get-by-assignment-id'; },
  get ASSIGN_DETAIL_SCM() { return this.API + '/assignment-general/api/assignment/get-by-id-with-data-for-scm'; },
  get PROGRESS_URL() { return this.API + '/analytic/api/v2/assignment/report-progress-assignment'; },
  get REGION_URL() { return this.API + '/region/api/v1/region'; },
  get REGION_META() { return this.API + '/region/api/v1/region-metadata'; },
  get SURVEY_LIST() { return this.API + '/survey/api/v1/surveys/datatable'; },
  get SURVEY_DETAIL() { return this.API + '/survey/api/v1/surveys'; },
  get SURVEY_ROLES() { return this.API + '/survey/api/v1/survey-roles'; },
  get SURVEY_USER_INFO() { return this.API + '/survey/api/v1/users/myinfo'; },
  get ALLOC_URL() { return this.API + '/survey-user/api/v1/allocations-view/by-user'; },
  get EMAIL_URL() { return this.API + '/email/api/v1/email-schedule/datatable'; },

  // ── Survey & Group (SE2026 defaults) ──────────────
  GROUP_ID: 'a45adac1-e711-4c15-b3f9-1f30fc151565',
  SURVEY_PERIOD_ID: 'fd68e454-ba45-4b85-8205-f3bf777ded24',

  // ── Roles ────────────────────────────────────────────
  ROLES: {
    pengawas: { id: '93bcf446-c4c1-4462-8ed0-4b0f7ae89e52', label: 'pengawas' },
    pencacah: { id: '6d7d919a-45e5-4779-bb87-2905b49fd31a', label: 'pencacah' },
  },

  // ── Detection ────────────────────────────────────────
  FASIH_HOST: 'fasih-sm.bps.go.id',
  FASIH_APP: 'fasih-sm.bps.go.id/app',

  // ── Tuning ───────────────────────────────────────────
  SIZE_CANDIDATES: [10, 5],
  CAP: 1000,
  DELAY_MS: 1000,
  DELAY_JITTER_MS: 1000,
  MAX_RETRY: 6,
  LOG_MAX: 500,
  REQUEST_TIMEOUT: 60000,
  MAX_WORKERS: 2,
};
