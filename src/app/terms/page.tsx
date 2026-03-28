'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

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
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">利用規約</h1>
            </div>

            <div className="prose prose-gray max-w-none text-gray-800 space-y-6 leading-relaxed">
              <p>
                本利用規約（以下「本規約」）は、芝浦工業大学附属中学高等学校（以下「本校」）が提供する数学学習アプリケーション「Formix」（以下「本サービス」）の利用条件を定めるものです。本校の生徒（以下「ユーザー」）は、本規約に従って本サービスを利用するものとします。
              </p>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第1条（適用と目的）</h3>
                <p>
                  1. 本規約は、ユーザーと本校との間の、本サービスの利用に関わる一切の関係に適用されます。<br/>
                  2. 本サービスは、本校生徒の数学における学習習慣の定着と基礎学力の向上を支援することを目的として提供されます。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第2条（利用資格とアカウント管理）</h3>
                <p>
                  1. 本サービスは、本校が発行する指定のGoogleアカウント（@shibaurafzk.com）を所有する生徒のみが利用できます。<br/>
                  2. ユーザーは、自己の責任においてアカウントおよびパスワードを管理するものとし、第三者に譲渡または貸与することはできません。<br/>
                  3. アカウントの管理不十分、使用上の過誤、第三者の使用等による損害の責任はユーザーが負うものとします。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第3条（校則の遵守とペナルティ）</h3>
                <p>
                  1. ユーザーは、本サービスの利用にあたり、本校が定める**校則および生徒指導規程**を遵守しなければなりません。<br/>
                  2. 授業中の不適切な使用（教員の指示に従わない利用など）や、本サービスを通じた他者への嫌がらせ等、校則違反に該当する行為が確認された場合、通常の生徒指導の対象となる可能性があります。<br/>
                  3. ユーザーが以下のいずれかに該当する行為を行ったと本校が判断した場合、事前の予告なく本サービスの利用停止、または**当該ユーザーの学習データ（スコア、XP、レベル、称号を含むすべて）を削除**することがあります。
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>本規約または校則に違反する行為</li>
                  <li>システムのバグを意図的に利用する行為、自動化スクリプト・ツールを用いた不自然なポイント稼ぎなどの不正行為</li>
                  <li>他のユーザーの学習を妨害し、またはシステムに過度な負荷をかける行為</li>
                  <li>その他、本校が不適切と判断する行為</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第4条（学習データの利用・公表）</h3>
                <p>
                  1. 本校は、ユーザーが本サービスにおいて記録したスコア、プレイ回数、回答履歴などの学習データを、ランキングの表示等の機能提供および、教員による学習指導の目的で利用します。<br/>
                  2. ユーザーは、本校が学習データを個人が特定できない統計情報に加工した上で、教育工学等の**研究論文・学会発表・オープンデータとして外部に公表**することがあることに同意するものとします。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第5条（サービスの提供の停止等）</h3>
                <p>
                  本校は、システムの保守点検、更新、または不可抗力により、ユーザーに事前の通知をすることなく本サービスの全部または一部の提供を停止または中断することができるものとします。これによりユーザーに生じた不利益または損害について、本校は一切の責任を負わないものとします。
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold border-b pb-2 mb-3 mt-8">第6条（運営者）</h3>
                <p>
                  本サービスは、以下の責任者によって運営・管理されています。<br/>
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
