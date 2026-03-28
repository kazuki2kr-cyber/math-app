'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, UserCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

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
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">プライバシーポリシー</h1>
            </div>

            <div className="prose prose-gray max-w-none text-gray-800 space-y-6 leading-relaxed">
              <p>
                芝浦工業大学附属中学高等学校（以下「本校」）は、本校が提供する数学学習アプリケーション「Formix」（以下「本サービス」）における、生徒（以下「ユーザー」）の個人情報の取扱いについて、以下のとおりプライバシーポリシー（以下「本ポリシー」）を定めます。
              </p>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第1条（取得する情報と取得方法）</h3>
                <p>
                  本サービスは、ユーザーが指定のGoogleアカウント（@shibaurafzk.com）でログインする際に、以下の情報を取得します。
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>Googleアカウントのメールアドレス</li>
                  <li>Googleアカウントに登録されている表示名（氏名等）</li>
                  <li>本サービスにおける学習データ（解答ログ、スコア、プレイ時間、レベル、アバター設定等）</li>
                  <li>アクセス端末環境・通信ログに関する情報</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第2条（個人情報の利用目的）</h3>
                <p>
                  本校が本サービスを通じて取得した情報は、以下の目的で利用されます。
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>本サービスの提供・運用・ユーザー認証のため</li>
                  <li>学習意欲の向上のためのランキング（スコア・順位等）の生成・表示のため</li>
                  <li>教員による本校生徒に対する学習データ分析、および教育・個別指導のため</li>
                  <li>不正アクセス、不自然なスコア獲得、利用規約違反等に対する調査・対応のため</li>
                  <li>教育工学研究、および本校の教育実績としての統計化データ作成のため</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第3条（教育データの外部公表・第三者提供）</h3>
                <p>
                  1. 本校は、本サービスにおいて収集した学習履歴のデータを、ユーザー（生徒）個人が特定できない統計情報に加工したうえで、教育研究論文の執筆や学会発表等の目的で外部へ公表することがあります。<br/>
                  2. 本校は、前項に該当しない場合においては、原則としてユーザーの同意なく第三者に個人情報を提供いたしません。ただし、法令に基づく場合や、人の生命・身体・財産の保護のために必要がある場合はこの限りではありません。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第4条（安全措置およびデータ管理）</h3>
                <p>
                  本校は、ユーザーの情報の漏えい、滅失、または毀損の防止その他の安全管理のために、Google Cloud等が提供するセキュリティ機能を利用し、アクセス権限の適切な管理による防止策を講じます。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第5条（管理者）</h3>
                <p>
                  本サービスにおけるプライバシー保護およびデータの取り扱いに関する責任者は以下の通りです。<br/>
                  <strong>芝浦工業大学附属中学高等学校　数学科　市川和貴</strong>
                </p>
              </section>
            </div>

            <div className="mt-12 text-center text-sm text-gray-400">
              制定日: {new Date().toLocaleDateString('ja-JP')}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
