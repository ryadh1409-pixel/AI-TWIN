import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  DECIDE_URL,
  PREDICTION_URL,
  fetchDecisionFollowUps,
  postDecide,
  postDecisionFeedback,
  postDecisionOutcome,
  postGeneratePrediction,
  type DecisionFollowUpItem,
} from '@/services/api';
import { listMyDecisions, type DecisionListItem } from '@/services/decisionsFirestore';
import {
  logBehaviorDecisionCompleted,
  logBehaviorDecisionMade,
} from '@/services/userBehaviorFirestore';
import { parseDecisionMarkdown } from '@/utils/decisionMarkdown';
import { parsePredictionMarkdown } from '@/utils/predictionMarkdown';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BG = '#0c0c0e';
const CARD = '#16161a';
const BORDER = '#2a2a30';
const ACCENT = '#c8ff6a';
const TEXT = '#ececf1';
const MUTED = '#8b8b96';

function formatReminderAr(ms: number): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' });
  } catch {
    return '—';
  }
}

function Section({
  title,
  body,
  highlight,
}: {
  title: string;
  body: string;
  highlight?: boolean;
}) {
  if (!body.trim()) return null;
  return (
    <View style={[styles.section, highlight && styles.sectionHighlight]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
    </View>
  );
}

function ConfidenceBar({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return null;
  const pct = Math.min(100, Math.max(0, value));
  return (
    <View style={styles.confWrap}>
      <Text style={styles.confLabel}>الثقة {pct}%</Text>
      <View style={styles.confTrack}>
        <View style={[styles.confFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

export default function DecideScreen() {
  const insets = useSafeAreaInsets();
  const { idToken, refreshIdToken, user } = useAuth();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [resultConfidence, setResultConfidence] = useState<number | null>(null);
  const [feedbackDone, setFeedbackDone] = useState(false);
  const [history, setHistory] = useState<DecisionListItem[]>([]);
  const [followUps, setFollowUps] = useState<DecisionFollowUpItem[]>([]);
  const [loadingSide, setLoadingSide] = useState(false);
  const [outcomeBusyId, setOutcomeBusyId] = useState<string | null>(null);
  const [predictionMarkdown, setPredictionMarkdown] = useState('');
  const [predictionLoading, setPredictionLoading] = useState(false);

  const sessionIdRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const predictionSlotDoneRef = useRef(false);
  const autoPredictionCallsRef = useRef(0);

  const sections = parseDecisionMarkdown(markdown);
  const displayConfidence =
    resultConfidence ??
    (() => {
      const c = sections.confidence;
      if (!c) return null;
      const m = c.match(/(\d{1,3})\s*%/);
      return m ? Math.min(100, Math.max(0, parseInt(m[1], 10))) : null;
    })();

  const predictionSections = parsePredictionMarkdown(predictionMarkdown);

  const runPrediction = useCallback(
    async (opts: { afterDecision?: boolean; newDecisionHint?: string; force?: boolean }) => {
      if (!PREDICTION_URL) return;
      if (predictionSlotDoneRef.current && !opts.force) return;
      const weakAuto = !opts.force && !opts.afterDecision;
      if (weakAuto && autoPredictionCallsRef.current >= 2) return;
      if (weakAuto) autoPredictionCallsRef.current += 1;

      let token = idToken ?? (await refreshIdToken());
      if (!token) return;
      setPredictionLoading(true);
      try {
        const out = await postGeneratePrediction(token, {
          sessionId: sessionIdRef.current,
          afterDecision: opts.afterDecision === true,
          newDecisionHint: opts.newDecisionHint,
          force: opts.force === true,
        });
        if (out.skipped) {
          if (out.reason === 'session_limit') predictionSlotDoneRef.current = true;
          return;
        }
        predictionSlotDoneRef.current = true;
        setPredictionMarkdown(out.markdown);
      } catch (e) {
        console.warn('[decide screen] prediction', e);
      } finally {
        setPredictionLoading(false);
      }
    },
    [idToken, refreshIdToken],
  );

  const reloadLists = useCallback(
    async (opts?: { skipPredictionAuto?: boolean }) => {
    const uid = user?.uid;
    if (!uid || !isFirebaseConfigured()) return;
    setLoadingSide(true);
    try {
      const rows = await listMyDecisions(uid, 25);
      setHistory(rows);
      if (
        PREDICTION_URL &&
        !opts?.skipPredictionAuto &&
        rows.length >= 4
      ) {
        void runPrediction({});
      }
      let token = idToken;
      if (!token) token = await refreshIdToken();
      if (token && DECIDE_URL) {
        const fu = await fetchDecisionFollowUps(token);
        setFollowUps(fu.items);
      } else {
        setFollowUps([]);
      }
    } catch (e) {
      console.warn('[decide screen] reloadLists', e);
    } finally {
      setLoadingSide(false);
    }
    },
    [DECIDE_URL, PREDICTION_URL, idToken, refreshIdToken, runPrediction, user?.uid],
  );

  useFocusEffect(
    useCallback(() => {
      void reloadLists();
    }, [reloadLists]),
  );

  const runDecide = useCallback(async () => {
    const q = input.trim();
    if (!q) {
      Alert.alert('تنبيه', 'اكتب قرارك أو سؤالك أولاً.');
      return;
    }
    if (!isFirebaseConfigured()) {
      Alert.alert('Firebase', 'فعّل Firebase في التطبيق لتسجيل الدخول.');
      return;
    }
    let token = idToken;
    if (!token) {
      token = await refreshIdToken();
    }
    if (!token) {
      Alert.alert('تسجيل الدخول', 'لم يتم الحصول على رمز المستخدم.');
      return;
    }
    setLoading(true);
    setFeedbackDone(false);
    setMarkdown('');
    setDecisionId(null);
    setResultConfidence(null);
    try {
      const out = await postDecide(token, q);
      setMarkdown(out.markdown);
      setDecisionId(out.decisionId);
      setResultConfidence(out.confidence);
      if (user?.uid && out.decisionId) {
        void logBehaviorDecisionMade(user.uid, out.decisionId, q);
      }
      await reloadLists({ skipPredictionAuto: true });
      await runPrediction({
        afterDecision: true,
        newDecisionHint: q.slice(0, 400),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('خطأ', msg);
    } finally {
      setLoading(false);
    }
  }, [idToken, input, refreshIdToken, reloadLists, runPrediction, user?.uid]);

  const sendFeedback = useCallback(
    async (helpful: boolean) => {
      if (!decisionId || feedbackDone) return;
      let token = idToken;
      if (!token) token = await refreshIdToken();
      if (!token) return;
      try {
        await postDecisionFeedback(token, decisionId, helpful);
        setFeedbackDone(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert('تعليق', msg);
      }
    },
    [decisionId, feedbackDone, idToken, refreshIdToken],
  );

  const onOutcome = useCallback(
    async (id: string, executed: boolean) => {
      let token = idToken;
      if (!token) token = await refreshIdToken();
      if (!token) return;
      setOutcomeBusyId(id);
      try {
        await postDecisionOutcome(token, id, executed, executed ? 'تم التنفيذ' : 'ما نفذت');
        if (user?.uid) void logBehaviorDecisionCompleted(user.uid, id, executed);
        await reloadLists();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert('خطأ', msg);
      } finally {
        setOutcomeBusyId(null);
      }
    },
    [idToken, refreshIdToken, reloadLists, user?.uid],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.headline}>Decision Assistant</Text>
      <Text style={styles.headlineAr}>مساعد القرار</Text>
      <Text style={styles.sub}>تحليل، توصية، متابعة، وتعلّم من النتائج</Text>

      <TextInput
        style={styles.input}
        placeholder="ما القرار؟ (شخصي، مشروع، وظيفة…)"
        placeholderTextColor={MUTED}
        value={input}
        onChangeText={setInput}
        multiline
        textAlignVertical="top"
        editable={!loading}
      />

      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
        onPress={runDecide}
        disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#111" />
        ) : (
          <Text style={styles.primaryBtnText}>ساعدني أقرر</Text>
        )}
      </Pressable>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        keyboardShouldPersistTaps="handled">
        {!!PREDICTION_URL && (predictionLoading || !!predictionMarkdown.trim()) && (
          <View style={styles.predCard}>
            <Text style={styles.predHead}>توقعاتي لك</Text>
            {predictionLoading && !predictionMarkdown.trim() ? (
              <ActivityIndicator color={MUTED} style={{ marginVertical: 8 }} />
            ) : null}
            {!!predictionSections.prediction.trim() && (
              <View style={styles.predBlock}>
                <Text style={styles.predLabel}>التوقع</Text>
                <Text style={styles.predBody}>{predictionSections.prediction}</Text>
              </View>
            )}
            {!!predictionSections.why.trim() && (
              <View style={styles.predBlock}>
                <Text style={styles.predLabel}>لماذا</Text>
                <Text style={styles.predBodyMuted}>{predictionSections.why}</Text>
              </View>
            )}
            {!!predictionSections.risk.trim() && (
              <View style={styles.predBlock}>
                <Text style={styles.predLabel}>انتباه</Text>
                <Text style={styles.predBodyMuted}>{predictionSections.risk}</Text>
              </View>
            )}
            {!!predictionSections.betterMove.trim() && (
              <View style={styles.predBlock}>
                <Text style={styles.predLabel}>اقتراح أوضح</Text>
                <Text style={styles.predBody}>{predictionSections.betterMove}</Text>
              </View>
            )}
            <Pressable
              onPress={() => void runPrediction({ force: true })}
              disabled={predictionLoading}
              hitSlop={8}
              style={({ pressed }) => [styles.predRefresh, pressed && { opacity: 0.75 }]}>
              <Text style={styles.predRefreshText}>تحديث التوقع</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.blockTitle}>متابعة قراراتي</Text>
        {loadingSide && <Text style={styles.mutedSmall}>جاري التحميل…</Text>}

        {followUps.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.blockSubtitle}>تذكير متابعة</Text>
            {followUps.map((fu) => (
              <View key={fu.decisionId} style={styles.fuCard}>
                <Text style={styles.fuPrompt}>{fu.followUpSuggestion}</Text>
                <Text style={styles.fuCtx} numberOfLines={2}>
                  {fu.userInput}
                </Text>
                <View style={styles.outcomeRow}>
                  <Pressable
                    style={[styles.outBtn, styles.outDone]}
                    disabled={outcomeBusyId === fu.decisionId}
                    onPress={() => void onOutcome(fu.decisionId, true)}>
                    {outcomeBusyId === fu.decisionId ? (
                      <ActivityIndicator color={ACCENT} size="small" />
                    ) : (
                      <Text style={styles.outDoneText}>تم التنفيذ</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={[styles.outBtn, styles.outSkip]}
                    disabled={outcomeBusyId === fu.decisionId}
                    onPress={() => void onOutcome(fu.decisionId, false)}>
                    <Text style={styles.outSkipText}>ما نفذت</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {history.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.blockSubtitle}>آخر القرارات</Text>
            {history.map((h) => (
              <View key={h.id} style={styles.histCard}>
                <Text style={styles.histInput} numberOfLines={2}>
                  {h.userInput}
                </Text>
                <Text style={styles.histRec} numberOfLines={1}>
                  → {h.recommendation || '—'}
                </Text>
                <Text style={styles.histMeta}>
                  {h.followUpStatus === 'done' ? 'مكتمل' : 'متابعة'} · ثقة{' '}
                  {h.confidence != null ? `${h.confidence}%` : '—'}
                  {h.lastReminderSentAtMs
                    ? ` · آخر تذكير: ${formatReminderAr(h.lastReminderSentAtMs)}`
                    : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {!!markdown && (
          <>
            <Text style={styles.blockTitle}>النتيجة</Text>
            <ConfidenceBar value={displayConfidence} />
            <Section title="🧠 الملخص" body={sections.summary} />
            <Section title="📊 الخيارات والدرجات" body={sections.options} />
            <Section title="✅ التوصية" body={sections.recommendation} highlight />
            <Section title="💡 التفسير" body={sections.reasoning} />
            <Section title="🎯 الثقة" body={sections.confidence} />
            <Section title="🚀 خطة العمل" body={sections.actionPlan} />
            <Section title="📈 PMF" body={sections.pmf} />

            {decisionId && !feedbackDone && (
              <View style={styles.feedbackRow}>
                <Text style={styles.feedbackLabel}>هل ساعدك التحليل؟</Text>
                <Pressable style={[styles.fbYes, styles.fbBtn]} onPress={() => void sendFeedback(true)}>
                  <Text style={styles.fbYesText}>نعم</Text>
                </Pressable>
                <Pressable style={[styles.fbNo, styles.fbBtn]} onPress={() => void sendFeedback(false)}>
                  <Text style={styles.fbNoText}>لا</Text>
                </Pressable>
              </View>
            )}
            {feedbackDone && <Text style={styles.thanks}>شكراً لتعليقك</Text>}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 16,
  },
  headline: {
    color: TEXT,
    fontSize: 20,
    fontWeight: '700',
  },
  headlineAr: {
    color: ACCENT,
    fontSize: 17,
    fontWeight: '700',
    marginTop: 2,
  },
  sub: {
    color: MUTED,
    fontSize: 13,
    marginTop: 6,
    marginBottom: 12,
  },
  blockTitle: {
    color: TEXT,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4,
  },
  blockSubtitle: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  mutedSmall: { color: MUTED, fontSize: 12, marginBottom: 8 },
  block: { marginBottom: 18 },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    color: TEXT,
    backgroundColor: CARD,
    fontSize: 16,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnPressed: { opacity: 0.88 },
  primaryBtnText: {
    color: '#111',
    fontSize: 17,
    fontWeight: '700',
  },
  scroll: { flex: 1 },
  confWrap: { marginBottom: 12 },
  confLabel: { color: MUTED, fontSize: 13, marginBottom: 6 },
  confTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#222',
    overflow: 'hidden',
  },
  confFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  section: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    backgroundColor: CARD,
  },
  sectionHighlight: {
    borderColor: ACCENT,
    borderLeftWidth: 4,
    backgroundColor: '#1a1f14',
  },
  sectionTitle: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  sectionBody: {
    color: TEXT,
    fontSize: 15,
    lineHeight: 22,
  },
  fuCard: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#121218',
  },
  fuPrompt: { color: TEXT, fontSize: 15, lineHeight: 22, marginBottom: 8 },
  fuCtx: { color: MUTED, fontSize: 12, marginBottom: 10 },
  outcomeRow: { flexDirection: 'row', flexWrap: 'wrap' },
  outBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginRight: 10,
    minWidth: 110,
    alignItems: 'center',
  },
  outDone: { backgroundColor: '#1e2a18', borderWidth: 1, borderColor: ACCENT },
  outDoneText: { color: ACCENT, fontWeight: '700' },
  outSkip: { backgroundColor: '#2a1818', borderWidth: 1, borderColor: '#664' },
  outSkipText: { color: '#ebb', fontWeight: '700' },
  histCard: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: CARD,
  },
  histInput: { color: TEXT, fontSize: 14 },
  histRec: { color: MUTED, fontSize: 13, marginTop: 4 },
  histMeta: { color: MUTED, fontSize: 11, marginTop: 4 },
  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 8,
    marginBottom: 16,
  },
  feedbackLabel: { color: MUTED, fontSize: 14, marginRight: 8 },
  fbBtn: { marginRight: 10, marginBottom: 6 },
  fbYes: {
    backgroundColor: '#234',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  fbYesText: { color: ACCENT, fontWeight: '600' },
  fbNo: {
    backgroundColor: '#332222',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  fbNoText: { color: '#f88', fontWeight: '600' },
  thanks: { color: MUTED, fontSize: 14, marginBottom: 12 },
  predCard: {
    borderWidth: 1,
    borderColor: '#1e1e24',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    backgroundColor: '#101014',
  },
  predHead: {
    color: '#6f6f7a',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  predBlock: { marginBottom: 8 },
  predLabel: { color: MUTED, fontSize: 11, marginBottom: 4 },
  predBody: { color: TEXT, fontSize: 13, lineHeight: 20 },
  predBodyMuted: { color: '#a4a4ae', fontSize: 13, lineHeight: 20 },
  predRefresh: { alignSelf: 'flex-end', marginTop: 4, paddingVertical: 4, paddingHorizontal: 4 },
  predRefreshText: { color: '#5c5c68', fontSize: 12 },
});
