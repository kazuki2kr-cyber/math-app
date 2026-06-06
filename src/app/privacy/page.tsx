'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, UserCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { LEGAL_EFFECTIVE_DATE_LABEL } from '@/lib/legal';

export default function PrivacyPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#F8FAEB] flex flex-col p-4 md:py-12 md:px-8">
      <div className="max-w-3xl mx-auto w-full space-y-8">
        <Button variant="ghost" onClick={() => router.push('/')} className="hover:bg-white/50 text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="w-5 h-5 mr-2" /> 戻る
        </Button>

        <Card className="border-0 shadow-lg overflow-hidden bg-white">
          <div className="h-2 w-full bg-primary"></div>
          <CardContent className="p-8 md:p-12">
            <div className="flex items-center gap-4 mb-8">
              <div className="p-3 bg-primary/10 rounded-full text-primary">
                <UserCheck className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">プライバシーポリシー</h1>
                <p className="text-sm text-gray-500 mt-2">最終改正日: {LEGAL_EFFECTIVE_DATE_LABEL}</p>
              </div>
            </div>

            <div className="prose prose-gray max-w-none text-gray-800 space-y-6 leading-relaxed">
              <p>
                芝浦工業大学附属中学高等学校（以下「本校」）は、本校が提供する学習支援サービス「Formix」（以下「本サービス」）における個人情報および教育データの取扱いについて、以下のとおりプライバシーポリシー（以下「本ポリシー」）を定めます。
              </p>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第1条（取得する情報）</h3>
                <p>
                  本サービスは、ユーザーが学校アカウント（@shibaurafzk.com）または管理者が許可した Google アカウントでログインし、本サービスを利用する際に、以下の情報を取得または生成します。
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>Google アカウントのメールアドレス、表示名、ユーザー ID、認証状態、管理者または個別許可に関する情報</li>
                  <li>学習データ（単元、問題、選択肢、解答、正誤、スコア、XP、レベル、称号、アバター、プレイ時間、提出回数、復習状況、対戦結果、ランキング情報）</li>
                  <li>記述式・手書き機能に関するデータ（答案画像、OCR 結果、AI による文字起こし、採点結果、ルーブリック別評価、フィードバック、モデル解答、提出制限の利用状況）</li>
                  <li>管理者分析に必要なデータ（問題別・単元別・カテゴリ別・ユーザー別の集計、誤答傾向、相関、リスク指標、不正検知ログ）</li>
                  <li>アプリ内フィードバック（本文、送信ページ、User-Agent、送信者の氏名・メールアドレス、対応状況）</li>
                  <li>アクセス端末環境、通信ログ、エラー情報、セキュリティログ、利用日時、同意バージョン、同意日時</li>
                  <li>ブラウザのローカルストレージ等に保存される表示・キャッシュ用データ（単元一覧、演習データの一時キャッシュ等）</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第2条（利用目的）</h3>
                <p>
                  本校は、取得した情報を以下の目的で利用します。
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>本サービスの提供、ログイン認証、利用資格確認、ユーザー管理のため</li>
                  <li>数学、漢字、対戦、記述式イベント、ランキング、フィードバック等の各機能を提供するため</li>
                  <li>スコア、XP、レベル、称号、ランキング、提出回数、復習対象、対戦結果を計算・表示・保存するため</li>
                  <li>手書き答案の OCR、AI 採点、採点補助、教員確認、採点品質改善のため</li>
                  <li>教員による学習状況の把握、個別指導、教材改善、授業改善、学習支援のため</li>
                  <li>不正アクセス、不自然なスコア獲得、規約違反、システムへの過負荷、データ改ざんの調査・対応のため</li>
                  <li>本サービスの品質改善、障害調査、セキュリティ確保、利用状況分析のため</li>
                  <li>教育工学研究、学校内外への報告、教育改善資料、統計化データ、公開レポート作成のため</li>
                  <li>規約・プライバシーポリシーへの同意状況を管理し、重要改定時に再同意を求めるため</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第3条（利用する外部サービス・委託先）</h3>
                <p>
                  本サービスは、提供・運用・分析・採点補助のために、以下の外部サービスを利用します。これらのサービスには、本ポリシーの利用目的の範囲内で必要な情報が送信または保存されることがあります。
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>Firebase Authentication: ログイン認証とユーザー識別</li>
                  <li>Cloud Firestore: ユーザープロフィール、学習履歴、分析イベント、フィードバック等の保存</li>
                  <li>Firebase Realtime Database: 対戦ルーム、対戦中の状態、対戦結果の処理</li>
                  <li>Cloud Functions: スコア・XP・ランキング・採点・不正検知等のサーバー処理</li>
                  <li>BigQuery: 学習データの集計、管理者分析、レポート用集計</li>
                  <li>Google Cloud Vision API: 漢字等の手書き画像の OCR 処理</li>
                  <li>Google Gemini API: 記述式答案の文字起こし、採点補助、フィードバック生成</li>
                  <li>Vercel: フロントエンドアプリケーションの配信</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第4条（ランキング・管理分析・公開レポート）</h3>
                <p>
                  1. ランキングや対戦結果では、表示名、アバター、スコア、XP、レベル、順位などが、他の認証済みユーザーに表示される場合があります。<br />
                  2. 管理者画面では、教員および管理者が、ユーザー別の成績、正答率、提出履歴、誤答傾向、リスク指標、フィードバック、不正検知ログ等を確認できる場合があります。<br />
                  3. 公開または配布を目的とするレポートでは、氏名、メールアドレス、ユーザー ID 等の直接識別子を含めず、少人数データの秘匿、k-匿名性に基づくしきい値、集計値のみの表示など、再識別リスクを低減する措置を講じます。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第5条（第三者提供・外部公表）</h3>
                <p>
                  1. 本校は、法令に基づく場合、人の生命・身体・財産の保護のために必要な場合、学校運営上必要な場合、または本人の同意がある場合を除き、個人を識別できる形で個人情報を第三者に提供しません。<br />
                  2. 本校は、学習履歴等の教育データを、個人が特定されない統計情報に加工した上で、教育研究論文、学会発表、授業改善資料、学校内外への報告、公開レポート等に利用または公表することがあります。<br />
                  3. 外部クラウドサービスへの送信は、本サービスの提供・運用・採点補助・分析に必要な範囲で行います。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第6条（保存期間・削除）</h3>
                <p>
                  1. 詳細な提出履歴や答案データの一部には、一定期間後に削除される設定が適用される場合があります。ただし、ユーザーの累計スコア、XP、ランキング、単元別集計、分析イベント、統計化データ、不正検知ログ、フィードバック等は、教育上・運用上・セキュリティ上必要な期間保存されることがあります。<br />
                  2. 管理者は、教育上または運用上必要な場合、特定の提出履歴、スコア、XP、ランキング、フィードバック、分析データ等を修正または削除することがあります。<br />
                  3. ユーザーが情報の確認、訂正、削除等を希望する場合は、運営責任者または担当教員に相談してください。対応範囲は、学校運営、教育記録、システム保全、法令上の必要性を踏まえて判断します。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第7条（安全管理措置）</h3>
                <p>
                  本校は、ユーザー情報の漏えい、滅失、毀損、不正アクセス、改ざんを防止するため、Firebase / Google Cloud 等の認証、アクセス制御、セキュリティルール、管理者権限の限定、サーバー側でのスコア再計算、ログ確認、公開レポート用データの分離など、必要かつ適切な安全管理措置を講じます。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第8条（ポリシーの改定と再同意）</h3>
                <p>
                  本校は、法令、学校運用、サービス内容、外部サービス、データの取扱いの変更に応じて、本ポリシーを改定することがあります。重要な改定を行う場合、本サービス上で通知し、必要に応じてユーザーに再同意を求めます。{LEGAL_EFFECTIVE_DATE_LABEL} 改正版への同意は、本サービスの継続利用に必要です。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第9条（管理者・問い合わせ先）</h3>
                <p>
                  本サービスにおけるプライバシー保護およびデータの取り扱いに関する責任者は以下の通りです。<br />
                  <strong>芝浦工業大学附属中学高等学校　数学科　市川和貴</strong>
                </p>
              </section>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
