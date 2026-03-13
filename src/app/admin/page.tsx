'use client';

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { writeBatch, doc } from 'firebase/firestore';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function AdminPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // 簡易的な管理者バリデーション（kazuki2kr@gmail.com と ichikawa.kazuki@shibaurafzk.com のみ）
  // 先生のアカウントなど複数ある場合はFirestore側にロールを含めると堅牢
  const isAdmin = user?.email === 'kazuki2kr@gmail.com' || user?.email === 'ichikawa.kazuki@shibaurafzk.com';

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setMessage('CSVを解析中...');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const data = results.data as any[];
          setMessage(`解析完了. ${data.length}件のレコードを処理しています...`);

          // データをFirestoreのunitsに保存する形へ変換
          // CSVの例: unit_id, question_text, options, answer_index, explanation, image_url
          const unitsMap: Record<string, any> = {};

          data.forEach((row, index) => {
            const { unit_id, question_text, options, answer_index, explanation, image_url } = row;
            if (!unit_id) return;

            if (!unitsMap[unit_id]) {
              unitsMap[unit_id] = { id: unit_id, title: `単元 ${unit_id}`, questions: [] };
            }

            // optionsはカンマ区切り、またはJSON形式などで来る想定。とりあえずJSONかカンマでSplitするか試行
            let parsedOptions: string[] = [];
            try {
              // 1. JSONパースを試みる
              parsedOptions = JSON.parse(options);
            } catch (e) {
              // 2. 失敗した場合はカンマ区切りとみなす
              parsedOptions = typeof options === 'string' ? options.split(',').map(s => s.trim()) : [];
            }

            unitsMap[unit_id].questions.push({
              id: `q_${index}`,
              question_text: question_text || '',
              options: parsedOptions,
              answer_index: parseInt(answer_index) || 1,
              explanation: explanation || '',
              image_url: image_url || null,
            });
          });

          const batch = writeBatch(db);
          let count = 0;
          Object.values(unitsMap).forEach((unit) => {
            const unitRef = doc(db, 'units', unit.id);
            batch.set(unitRef, unit, { merge: true }); // 上書き・結合
            count++;
          });

          await batch.commit();
          setMessage(`完了: ${count} 個の単元データをFirestoreに保存しました。`);
        } catch (err: any) {
          console.error("Firestore Upload Error", err);
          setMessage(`エラー: ${err.message}`);
        } finally {
          setLoading(false);
        }
      },
      error: (error) => {
        setMessage(`CSV解析エラー: ${error.message}`);
        setLoading(false);
      }
    });
  };

  if (!isAdmin && user) {
    return (
      <div className="p-8 text-center text-red-500 font-bold">
        管理者権限がありません。
      </div>
    );
  }

  const handleDownloadTemplate = () => {
    // CSVテンプレートのヘッダーとサンプルデータ
    const csvContent = 
`unit_id,question_text,options,answer_index,explanation,image_url
unit_01,1+1は？,"[""1"",""2"",""3"",""4""]",2,1足す1は2です。,
unit_01,$x^2=4$ を解け,"[""x=2"",""x=-2"",""x=\\pm 2"",""解なし""]",3,平方根をとります。,
unit_02,次の図形の面積を求めよ,"[""10"",""20"",""30"",""40""]",2,底辺×高さ÷2です。,https://example.com/image.png
`;
    
    // Blobを作成してダウンロードリンクを発火
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'math_app_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">管理者ダッシュボード</h2>
      <Card>
        <CardHeader>
          <CardTitle>一括問題インポート (CSV)</CardTitle>
          <CardDescription>
            StudyAid等で作成したCSVデータをアップロードし、Firestoreへ一括登録します。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <Input 
              type="file" 
              accept=".csv" 
              onChange={handleFileUpload} 
              disabled={loading}
              className="flex-1"
            />
            <Button variant="outline" onClick={handleDownloadTemplate} type="button">
              テンプレートをダウンロード
            </Button>
          </div>
          {message && (
            <div className={`p-4 rounded-md ${message.includes('エラー') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
              {message}
            </div>
          )}
          <div className="text-sm text-gray-500">
            <p className="font-semibold mb-1">要求フォーマット</p>
            <ul className="list-disc list-inside space-y-1">
              <li>必須カラム: <code className="bg-gray-100 px-1 py-0.5 rounded">unit_id</code>, <code className="bg-gray-100 px-1 py-0.5 rounded">question_text</code>, <code className="bg-gray-100 px-1 py-0.5 rounded">options</code>, <code className="bg-gray-100 px-1 py-0.5 rounded">answer_index</code>, <code className="bg-gray-100 px-1 py-0.5 rounded">explanation</code>, <code className="bg-gray-100 px-1 py-0.5 rounded">image_url</code></li>
              <li><code className="bg-gray-100 px-1 py-0.5 rounded">question_text</code> はLaTeX数式記述（$数式$など）対応。</li>
              <li><code className="bg-gray-100 px-1 py-0.5 rounded">options</code> は <code>["選択肢1", "選択肢2"]</code> のJSON形式推奨。</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
