#!/usr/bin/env python3
"""
سكريبت للبحث عن وإصلاح الإجازات المتداخلة في قاعدة بيانات TeacherPro
"""

import psycopg2
from psycopg2 import sql

# معلومات الاتصال بقاعدة البيانات
DATABASE_URL = "postgresql://neondb_owner:npg_GM9KJLU1nHyP@ep-misty-cell-aqgxpff5-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

def get_connection():
    """إنشاء اتصال بقاعدة البيانات"""
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn

def find_overlapping_leaves(cursor):
    """البحث عن الإجازات المتداخلة"""
    print("=" * 70)
    print("🔍 البحث عن الإجازات المتداخلة...")
    print("=" * 70)
    
    # استعلام للعثور على الإجازات المتداخلة لكل طالب
    query = """
    SELECT 
        s1.id as leave1_id,
        s2.id as leave2_id,
        s1.student_id,
        st.name as student_name,
        s1.date_from as leave1_from,
        s1.date_to as leave1_to,
        s2.date_from as leave2_from,
        s2.date_to as leave2_to,
        s1.leave_type as leave1_type,
        s2.leave_type as leave2_type
    FROM "StudentLeave" s1
    INNER JOIN "StudentLeave" s2 ON 
        s1.student_id = s2.student_id AND 
        s1.id < s2.id AND
        (
            -- التداخل: Leave 1 يبدأ خلال Leave 2
            (s1.date_from >= s2.date_from AND s1.date_from <= s2.date_to) OR
            -- التداخل: Leave 1 ينتهي خلال Leave 2
            (s1.date_to >= s2.date_from AND s1.date_to <= s2.date_to) OR
            -- التداخل: Leave 1 يحتوي Leave 2 بالكامل
            (s1.date_from <= s2.date_from AND s1.date_to >= s2.date_to)
        )
    JOIN "Student" st ON s1.student_id = st.id
    ORDER BY s1.student_id, s1.date_from
    """
    
    cursor.execute(query)
    results = cursor.fetchall()
    
    if not results:
        print("\n✅ لا توجد إجازات متداخلة!")
        return []
    
    print(f"\n⚠️  تم العثور على {len(results)} حالة تداخل إجازات:\n")
    
    overlapping = []
    for row in results:
        leave_data = {
            'leave1_id': row[0],
            'leave2_id': row[1],
            'student_id': row[2],
            'student_name': row[3],
            'leave1_from': str(row[4]),
            'leave1_to': str(row[5]),
            'leave2_from': str(row[6]),
            'leave2_to': str(row[7]),
            'leave1_type': row[8],
            'leave2_type': row[9]
        }
        overlapping.append(leave_data)
        
        print(f"📌 الطالب: {leave_data['student_name']} (ID: {leave_data['student_id']})")
        print(f"   الإجازة 1: {leave_data['leave1_from']} → {leave_data['leave1_to']} ({leave_data['leave1_type']})")
        print(f"   الإجازة 2: {leave_data['leave2_from']} → {leave_data['leave2_to']} ({leave_data['leave2_type']})")
        print(f"   IDs: {leave_data['leave1_id']} / {leave_data['leave2_id']}")
        print()
    
    return overlapping

def fix_overlapping_leaves(cursor, overlapping):
    """إصلاح الإجازات المتداخلة - حذف الأحدث والاحتفاظ بالأقدم"""
    if not overlapping:
        return
    
    print("=" * 70)
    print("🔧 إصلاح الإجازات المتداخلة...")
    print("=" * 70)
    
    deleted_count = 0
    
    for item in overlapping:
        # حذف الإجازة الأحدث (leave2_id) والاحتفاظ بالأقدم (leave1_id)
        try:
            # أولاً نتحقق من وجود سجلات مرتبطة (grade backups)
            cursor.execute(
                'SELECT COUNT(*) FROM "StudentLeaveGradeBackup" WHERE "leaveId" = %s',
                (item['leave2_id'],)
            )
            backup_count = cursor.fetchone()[0]
            
            if backup_count > 0:
                # حذف السجلات المرتبطة أولاً
                cursor.execute(
                    'DELETE FROM "StudentLeaveGradeBackup" WHERE "leaveId" = %s',
                    (item['leave2_id'],)
                )
                print(f"   🗑️  حذف {backup_count} سجل backup للإجازة {item['leave2_id']}")
            
            # حذف الإجازة نفسها
            cursor.execute(
                'DELETE FROM "StudentLeave" WHERE id = %s',
                (item['leave2_id'],)
            )
            
            print(f"   ✅ تم حذف الإجازة المتداخلة:")
            print(f"      - الطالب: {item['student_name']}")
            print(f"      - الفترة المحذوفة: {item['leave2_from']} → {item['leave2_to']}")
            print(f"      - الفترة المحفوظة: {item['leave1_from']} → {item['leave1_to']}")
            print()
            
            deleted_count += 1
            
        except Exception as e:
            print(f"   ❌ خطأ في حذف إجازة {item['leave2_id']}: {e}")
            print()
    
    return deleted_count

def check_failed_migration_status(cursor):
    """التحقق من حالة الـ migration الفاشل"""
    print("=" * 70)
    print("📊 التحقق من حالة Migrations...")
    print("=" * 70)
    
    try:
        cursor.execute("""
            SELECT migration_id, started_at, finished_at, applied_steps_count 
            FROM "_prisma_migrations" 
            ORDER BY started_at DESC 
            LIMIT 5
        """)
        migrations = cursor.fetchall()
        
        print("\nآخر 5 migrations:\n")
        for m in migrations:
            status = "✅ مكتمل" if m[2] else "❌ فشل"
            print(f"   {m[0][:50]}... | {status} | Steps: {m[3]}")
        
    except Exception as e:
        print(f"⚠️  تعذر قراءة حالة Migrations: {e}")

def main():
    """الدالة الرئيسية"""
    print("\n" + "=" * 70)
    print("🛠️  سكريبت إصلاح الإجازات المتداخلة - TeacherPro")
    print("=" * 70)
    
    conn = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        
        # 1. التحقق من حالة Migrations
        check_failed_migration_status(cursor)
        
        # 2. البحث عن الإجازات المتداخلة
        overlapping = find_overlapping_leaves(cursor)
        
        if overlapping:
            # 3. إصلاح الإجازات المتداخلة
            print("\n" + "⚠️ " * 20)
            print("تحذير: سيتم حذف الإجازات المتداخلة (الأحدث فقط)")
            print("⚠️ " * 20 + "\n")
            
            deleted_count = fix_overlapping_leaves(cursor, overlapping)
            
            # حفظ التغييرات
            conn.commit()
            
            print("=" * 70)
            print(f"✅ تم إصلاح {deleted_count} إجازة متداخلة بنجاح!")
            print("=" * 70)
            
            # التحقق مرة أخرى
            print("\n🔄 التحقق من عدم وجود تداخلات بعد الإصلاح...")
            remaining = find_overlapping_leaves(cursor)
            
            if not remaining:
                print("\n🎉 جميع المشاكل تم حلها! يمكن الآن إعادة النشر.")
            else:
                print(f"\n⚠️  لا تزال هناك {len(remaining)} مشكلة تحتاج لإصلاح يدوي.")
        else:
            print("\n✅ لا توجد إجازات متداخلة - المشكلة قد تكون في شيء آخر.")
        
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
