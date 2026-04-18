import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  BEHAVIOR_INSIGHT_URL,
  postGenerateBehaviorInsight,
  postInsightHelpfulFeedback,
} from '@/services/api';
import { listUserInsights, type UserInsightDoc } from '@/services/insightsFirestore';
import { logBehaviorUsagePing } from '@/services/userBehaviorFirestore';
import { parseInsightMarkdown } from '@/utils/insightMarkdown';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BG = '#0b0b0d';
const CARD = '#151518';
const BORDER = '#2a2a32';
const ACCENT = '#7dd3fc';
const TEXT = '#ececf1';
const MUTED = '#8b8b96';

function InsightCard({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  if (!body.trim()) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </View>
  );
}

function formatDate(ms: number): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const { user, idToken, refreshIdToken } = useAuth();
  const [items, setItems] = useState<UserInsightDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const reload = useCallback(async () => {
    const uid = user?.uid;
    if (!uid || !isFirebaseConfigured()) return;
    setLoading(true);
    try {
      const rows = await listUserInsights(uid, 25);
      setItems(rows);
      if (uid) void logBehaviorUsagePing(uid);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const latest = items[0];
  const sections = latest ? parseInsightMarkdown(latest.markdown) : parseInsightMarkdown('');

  useEffect(() => {
    setFeedbackSubmitted(false);
  }, [latest?.id]);

  const generate = async (force: boolean) => {
    if (!BEHAVIOR_INSIGHT_URL) {
      Alert.alert('Config', 'Set EXPO_PUBLIC_BEHAVIOR_INSIGHT_URL in .env.');
      return;
    }
    let token = idToken;
    if (!token) token = await refreshIdToken();
    if (!token) {
      Alert.alert('Auth', 'Sign in to generate insights.');
      return;
    }
    setGenerating(true);
    try {
      const out = await postGenerateBehaviorInsight(token, { force });
      if (out.skipped) {
        Alert.alert(
          'Insights',
          out.reason === 'daily_cap'
            ? 'You already have a fresh insight from the last 24 hours.'
            : out.reason === 'not_enough_signal'
              ? 'Keep using the app a bit more — we need a few more signals first.'
              : `Skipped: ${out.reason}`,
        );
      }
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Error', msg);
    } finally {
      setGenerating(false);
    }
  };

  const sendFeedback = async (helpful: boolean) => {
    if (!latest?.id) return;
    let token = idToken;
    if (!token) token = await refreshIdToken();
    if (!token) return;
    try {
      await postInsightHelpfulFeedback(token, latest.id, helpful);
      setFeedbackSubmitted(true);
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Feedback', msg);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
      <Text style={styles.h1}>Insights about you</Text>
      <Text style={styles.h1ar}>رؤى عنك</Text>
      <Text style={styles.sub}>Patterns from how you use the app — private to you.</Text>

      <View style={styles.row}>
        <Pressable
          style={[styles.btn, styles.btnGrow, generating && styles.btnDisabled]}
          onPress={() => void generate(false)}
          disabled={generating}>
          {generating ? (
            <ActivityIndicator color="#111" />
          ) : (
            <Text style={styles.btnText}>Refresh insight</Text>
          )}
        </Pressable>
        <Pressable style={styles.btnGhost} onPress={() => void generate(true)} disabled={generating}>
          <Text style={styles.btnGhostText}>Force</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled">
        {loading && !items.length ? (
          <ActivityIndicator color={ACCENT} style={{ marginTop: 24 }} />
        ) : null}

        {latest ? (
          <>
            <Text style={styles.sectionLabel}>Latest</Text>
            <Text style={styles.dateLine}>{formatDate(latest.createdAtMs)}</Text>
            <InsightCard title="🧠 Behavioral insight" body={sections.insight} />
            <InsightCard title="📊 Pattern" body={sections.pattern} />
            <InsightCard title="⚠️ Risk / weakness" body={sections.risk} />
            <InsightCard title="💡 Recommendation" body={sections.recommendation} />
            <InsightCard title="🎯 Opportunity" body={sections.opportunity} />

            {latest.helpful == null && !feedbackSubmitted && (
              <View style={styles.feedbackBox}>
                <Text style={styles.feedbackQ}>Was this insight helpful?</Text>
                <View style={styles.feedbackRow}>
                  <Pressable style={styles.fbYes} onPress={() => void sendFeedback(true)}>
                    <Text style={styles.fbYesText}>Yes</Text>
                  </Pressable>
                  <Pressable style={styles.fbNo} onPress={() => void sendFeedback(false)}>
                    <Text style={styles.fbNoText}>No</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </>
        ) : (
          !loading && (
            <Text style={styles.empty}>No insights yet. Tap refresh when you have a few chats or decisions logged.</Text>
          )
        )}

        {items.length > 1 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 28 }]}>History</Text>
            {items.slice(1).map((it) => {
              const p = parseInsightMarkdown(it.markdown);
              return (
                <View key={it.id} style={styles.historyCard}>
                  <Text style={styles.historyDate}>{formatDate(it.createdAtMs)}</Text>
                  <Text style={styles.historyPreview} numberOfLines={3}>
                    {p.insight || it.patternSummary || it.markdown.slice(0, 200)}
                  </Text>
                  {it.helpful != null && (
                    <Text style={styles.historyMeta}>{it.helpful ? '👍 Helpful' : 'Feedback noted'}</Text>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingHorizontal: 16 },
  h1: { color: TEXT, fontSize: 22, fontWeight: '700' },
  h1ar: { color: ACCENT, fontSize: 18, fontWeight: '700', marginTop: 4 },
  sub: { color: MUTED, fontSize: 13, marginTop: 8, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  btnGrow: { flex: 1, marginRight: 10 },
  btn: {
    backgroundColor: ACCENT,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: '#111', fontWeight: '700', fontSize: 15 },
  btnGhost: { paddingHorizontal: 14, paddingVertical: 10 },
  btnGhostText: { color: ACCENT, fontWeight: '600' },
  sectionLabel: { color: MUTED, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  dateLine: { color: MUTED, fontSize: 13, marginBottom: 10 },
  card: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    backgroundColor: CARD,
  },
  cardTitle: { color: ACCENT, fontWeight: '700', marginBottom: 8, fontSize: 14 },
  cardBody: { color: TEXT, fontSize: 15, lineHeight: 22 },
  feedbackBox: {
    marginTop: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#12121a',
  },
  feedbackQ: { color: TEXT, fontWeight: '600', marginBottom: 10 },
  feedbackRow: { flexDirection: 'row' },
  fbYes: {
    backgroundColor: '#1a2a20',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    marginRight: 10,
    borderWidth: 1,
    borderColor: ACCENT,
  },
  fbYesText: { color: ACCENT, fontWeight: '700' },
  fbNo: {
    backgroundColor: '#2a1818',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#633',
  },
  fbNoText: { color: '#f99', fontWeight: '700' },
  empty: { color: MUTED, marginTop: 24, fontSize: 15, lineHeight: 22 },
  historyCard: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    backgroundColor: CARD,
  },
  historyDate: { color: MUTED, fontSize: 12, marginBottom: 6 },
  historyPreview: { color: TEXT, fontSize: 14, lineHeight: 20 },
  historyMeta: { color: MUTED, fontSize: 12, marginTop: 6 },
});
