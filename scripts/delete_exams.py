#!/usr/bin/env python3
"""
سكريبت لحذف امتحانين محددين وجميع سجلاتهم المرتبطة من قاعدة بيانات TeacherPro
"""

import psycopg2
from psycopg2 import sql

# معلومات الاتصال بقاعدة البيانات
DATABASE_URL = "postgresql://neondb_owner:npg_GM9KJLU1nHyP@ep-misty-cell-aqgxpff5-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# أسماء الامتحانات المراد حذفها
EXAM_NAMES = [
    "الفصل الثاني - الامتحان الاول يومي",
    "الفصل الثاني - امتحان ١ يومي"
]

def get_connection():
    """إنشاء اتصال بقاعدة البيانات"""
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn

def find_exams(cursor):
    """البحث عن الامتحانين المستهدفين"""
    print("=" * 60)
    print("🔍 البحث عن الامتحانات المستهدفة...")
    print("=" * 60)
    
    for name in EXAM_NAMES:
        cursor.execute(
            "SELECT id, name, type, date FROM \"Exam\" WHERE name = %s",
            (name,)
        )
        results = cursor.fetchall()
        
        if results:
            print(f"\n✅ تم العثور على الامتحان: '{name}'")
            for row in results:
                print(f"   - ID: {row[0]}")
                print(f"   - الاسم: {row[1]}")
                print(f"   - النوع: {row[2]}")
                print(f"   - التاريخ: {row[3]}")
        else:
            print(f"\n❌ لم يتم العثور على الامتحان: '{name}'")

def count_related_records(cursor, exam_id):
    """عد السجلات المرتبطة بالامتحان"""
    tables_counts = {}
    
    tables_to_check = [
        ("Grade", "examId"),
        ("CorrectionSheet", "examId"),
        ("OpportunityLog", "examId"),
        ("StudentLeave", "examId"),
        ("StudentCall", "examId"),
        ("TelegramExamSubmission", "examId"),
        ("GradeEntryMissingNote", "examId"),
        ("ExamCourse", "examId"),
        ("GradeSmartNote", "examId"),
        ("StudentLeaveGradeBackup", "examId"),
    ]
    
    for table, column in tables_to_check:
        try:
            cursor.execute(
                sql.SQL("SELECT COUNT(*) FROM {} WHERE {} = %s").format(
                    sql.Identifier(table),
                    sql.Identifier(column)
                ),
                (exam_id,)
            )
            count = cursor.fetchone()[0]
            if count > 0:
                tables_counts[table] = count
        except Exception as e:
            print(f"   ⚠️ خطأ في جدول {table}: {e}")
    
    return tables_counts

def delete_exam_and_records(cursor, exam_id, exam_name):
    """حذف الامتحان وجميع سجلاته المرتبطة"""
    print(f"\n{'=' * 60}")
    print(f"🗑️ جاري حذف الامتحان: '{exam_name}' (ID: {exam_id})")
    print(f"{'=' * 60}")
    
    # ترتيب الحذف مع مراعاة العلاقات بين الجداول
    deletion_order = [
        # أولاً: الجداول التي تعتمد على جداول أخرى
        ("TelegramSubmissionVersion", "examId"),
        ("TelegramExamSubmission", "examId"),
        ("StudentLeaveGradeBackup", "examId"),
        ("GradeSmartNote", "examId"),
        ("CorrectionSheet", "examId"),
        ("Grade", "examId"),
        ("StudentLeave", "examId"),
        ("StudentCall", "examId"),
        ("OpportunityLog", "examId"),
        ("GradeEntryMissingNote", "examId"),
        ("ExamCourse", "examId"),
        # أخيراً: الامتحان نفسه
        ("Exam", "id"),
    ]
    
    deleted_counts = {}
    
    for table, column in deletion_order:
        try:
            # للامتحان نفسه نستخدم id، للباقي نستخدم examId
            if table == "Exam":
                cursor.execute(
                    sql.SQL("DELETE FROM {} WHERE id = %s").format(
                        sql.Identifier(table)
                    ),
                    (exam_id,)
                )
            else:
                cursor.execute(
                    sql.SQL("DELETE FROM {} WHERE {} = %s").format(
                        sql.Identifier(table),
                        sql.Identifier(column)
                    ),
                    (exam_id,)
                )
            
            deleted = cursor.rowcount
            if deleted > 0:
                deleted_counts[table] = deleted
                print(f"   ✅ تم حذف {deleted} سجل من جدول {table}")
                
        except Exception as e:
            print(f"   ⚠️ خطأ في حذف من جدول {table}: {e}")
    
    return deleted_counts

def main():
    """الدالة الرئيسية"""
    print("\n" + "=" * 60)
    print("📋 سكريبت حذف الامتحانات من TeacherPro")
    print("=" * 60)
    
    conn = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        
        # البحث عن الامتحانات
        find_exams(cursor)
        
        # جمع IDs الامتحانات المراد حذفها
        exam_ids_to_delete = []
        
        print("\n" + "-" * 60)
        print("📊 ملخص السجلات المرتبطة بكل امتحان:")
        print("-" * 60)
        
        for name in EXAM_NAMES:
            cursor.execute(
                "SELECT id, name FROM \"Exam\" WHERE name = %s",
                (name,)
            )
            results = cursor.fetchall()
            
            for row in results:
                exam_id = row[0]
                exam_name = row[1]
                
                # عد السجلات المرتبطة
                related = count_related_records(cursor, exam_id)
                
                if related:
                    print(f"\n📌 الامتحان: '{exam_name}' (ID: {exam_id})")
                    total = 0
                    for table, count in related.items():
                        print(f"   • {table}: {count} سجل")
                        total += count
                    print(f"   ──────────────────────────")
                    print(f"   📊 المجموع: {total} سجل")
                
                exam_ids_to_delete.append((exam_id, exam_name))
        
        if not exam_ids_to_delete:
            print("\n❌ لا توجد امتحانات للحذف!")
            return
        
        # تأكيد الحذف
        print("\n" + "⚠️ " * 20)
        print("تحذير: سيتم حذف هذه الامتحانات وجميع سجلاتها بشكل نهائي!")
        print("⚠️ " * 20)
        
        # تنفيذ الحذف
        total_deleted = {}
        
        for exam_id, exam_name in exam_ids_to_delete:
            deleted = delete_exam_and_records(cursor, exam_id, exam_name)
            
            for table, count in deleted.items():
                if table not in total_deleted:
                    total_deleted[table] = 0
                total_deleted[table] += count
        
        # حفظ التغييرات
        conn.commit()
        
        print("\n" + "=" * 60)
        print("✅ تم الحذف بنجاح!")
        print("=" * 60)
        print("\n📊 إجمالي ما تم حذفه:")
        
        grand_total = 0
        for table, count in sorted(total_deleted.items()):
            print(f"   • {table}: {count} سجل")
            grand_total += count
        
        print(f"   ──────────────────────────")
        print(f"   📊 الإجمالي الكلي: {grand_total} سجل")
        
    except Exception as e:
        print(f"\n❌ حدث خطأ: {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()
            print("\n✅ تم إغلاق الاتصال بقاعدة البيانات")

if __name__ == "__main__":
    main()
