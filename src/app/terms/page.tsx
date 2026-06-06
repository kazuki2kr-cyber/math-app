'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { LEGAL_EFFECTIVE_DATE_LABEL } from '@/lib/legal';

export default function TermsPage() {
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
                <ShieldCheck className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">利用規約</h1>
                <p className="text-sm text-gray-500 mt-2">最終改正日: {LEGAL_EFFECTIVE_DATE_LABEL}</p>
              </div>
            </div>

            <div className="prose prose-gray max-w-none text-gray-800 space-y-6 leading-relaxed">
              <p>
                本利用規約（以下「本規約」）は、芝浦工業大学附属中学高等学校（以下「本校」）が提供する学習支援サービス「Formix」（以下「本サービス」）の利用条件を定めるものです。本校の生徒および本校または管理者が利用を許可した者（以下「ユーザー」）は、本規約に従って本サービスを利用するものとします。
              </p>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第1条（適用と目的）</h3>
                <p>
                  1. 本規約は、ユーザーと本校との間の、本サービスの利用に関わる一切の関係に適用されます。<br />
                  2. 本サービスは、数学、漢字、対戦、記述式イベント、ランキング、学習分析、フィードバック等の機能を通じて、本校における学習習慣の定着、基礎学力の向上、教員による学習支援を補助することを目的として提供されます。<br />
                  3. 本サービスの内容は、教育上または運用上の必要に応じて追加、変更、停止されることがあります。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第2条（利用資格とアカウント管理）</h3>
                <p>
                  1. 本サービスは、本校が発行する指定の Google アカウント（@shibaurafzk.com）または管理者が個別に許可した Google アカウントで利用できます。<br />
                  2. ユーザーは、自己の責任においてアカウントおよびパスワードを管理するものとし、第三者に譲渡または貸与してはなりません。<br />
                  3. アカウントの管理不十分、使用上の過誤、第三者の使用等により本校または他のユーザーに不利益が生じた場合、校則および本校の指導方針に基づき対応することがあります。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第3条（利用上の遵守事項）</h3>
                <p>
                  ユーザーは、本サービスの利用にあたり、本校が定める校則、生徒指導規程、教員の指示、および以下の事項を遵守しなければなりません。
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>授業中や学校生活において、教員の指示に反する形で利用しないこと</li>
                  <li>他のユーザーの学習、成績、ランキング、対戦体験を妨害しないこと</li>
                  <li>バグ、不具合、自動化スクリプト、外部ツール等を用いて、スコア、XP、ランキング、提出回数、対戦結果を不正に操作しないこと</li>
                  <li>他人のアカウントを利用し、または他人に自分のアカウントを利用させないこと</li>
                  <li>本サービス、Firebase、Google Cloud、Vercel 等のシステムに過度な負荷をかける行為をしないこと</li>
                  <li>フィードバック、記述式答案、対戦名、その他入力欄に、他者を傷つける内容、個人情報、機密情報、不適切な表現を入力しないこと</li>
                  <li>その他、本校が教育上または運用上不適切と判断する行為をしないこと</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第4条（学習データとランキング）</h3>
                <p>
                  1. 本校は、ユーザーが本サービスにおいて記録した解答履歴、正誤、スコア、XP、レベル、称号、アバター、プレイ時間、提出回数、対戦結果、ランキング情報、手書き答案、OCR 結果、AI 採点結果、フィードバック等のデータを、本サービスの提供、学習支援、不正検知、運用改善のために利用します。<br />
                  2. ランキング、対戦結果、プロフィール表示等において、ユーザーの表示名、アバター、スコア、XP、レベル、順位などが、他の認証済みユーザーに表示される場合があります。<br />
                  3. 記述式イベントや手書き入力を含む機能では、自動採点、文字認識、採点補助、教員確認のために、答案画像、認識結果、採点結果、フィードバックが保存または処理されることがあります。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第5条（AI・OCR 等の利用）</h3>
                <p>
                  1. 本サービスは、記述式答案の採点補助に Google の Gemini API、漢字等の手書き文字認識に Google Cloud Vision API などの外部クラウドサービスを利用することがあります。<br />
                  2. AI による採点、文字起こし、コメント、フィードバックは、学習支援および教員確認のための補助情報です。必要に応じて、教員または管理者が内容を確認し、訂正、削除、再評価することがあります。<br />
                  3. ユーザーは、AI 採点や OCR の結果に誤りがあり得ることを理解し、疑義がある場合は教員または運営責任者に相談するものとします。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第6条（学習分析・研究利用・外部公表）</h3>
                <p>
                  1. 本校は、学習状況の把握、個別指導、授業改善、教材改善、機能改善、不正検知のために、ユーザー単位またはクラス・単元・問題単位の分析を行うことがあります。<br />
                  2. 本校は、学習データを個人が特定されない統計情報に加工した上で、教育工学等の研究論文、学会発表、授業改善資料、学校内外への報告、公開レポート等に利用または公表することがあります。<br />
                  3. 公表または配布を目的とする資料では、氏名、メールアドレス、ユーザー ID 等の直接識別子を含めず、少人数データの秘匿など再識別リスクを低減する措置を講じます。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第7条（不正行為等への対応）</h3>
                <p>
                  ユーザーが本規約、校則、教員の指示に違反した場合、または不正行為、迷惑行為、システムへの攻撃・過負荷、データ改ざんの試み等が確認された場合、本校は事前の予告なく以下の対応を行うことがあります。
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>本サービスの一部または全部の利用停止</li>
                  <li>スコア、XP、ランキング、対戦結果、提出履歴等の修正または削除</li>
                  <li>不正アクセス、不自然なスコア獲得、規約違反に関するログ確認</li>
                  <li>通常の生徒指導または学校の運用ルールに基づく対応</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第8条（サービスの停止・変更）</h3>
                <p>
                  本校は、システムの保守点検、更新、障害対応、セキュリティ対応、外部サービスの仕様変更、不可抗力、教育上または運用上の必要により、ユーザーに事前の通知をすることなく本サービスの全部または一部を停止、変更、終了することがあります。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第9条（規約の改定と再同意）</h3>
                <p>
                  1. 本校は、法令、学校運用、サービス内容、利用する外部サービス、データの取扱いの変更に応じて、本規約およびプライバシーポリシーを改定することがあります。<br />
                  2. 重要な改定を行う場合、本校は本サービス上で通知し、必要に応じてユーザーに再同意を求めます。<br />
                  3. {LEGAL_EFFECTIVE_DATE_LABEL} 改正版への同意は、本サービスの継続利用に必要です。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第10条（運営者）</h3>
                <p>
                  本サービスは、以下の責任者によって運営・管理されています。<br />
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
