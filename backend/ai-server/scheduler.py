#scheduler.py

from ortools.sat.python import cp_model
import random
from typing import List, Dict, Any

# 요일 매핑은 함수 내부에 정의
TARGET_DAY_MAP = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4}

def check_time_conflict(c1: Dict[str, Any], c2: Dict[str, Any]) -> bool:
    """ 두 강의가 시간이 겹치면 True 반환 """
    for t1 in c1['times']:
        for t2 in c2['times']:
            if t1['day'] == t2['day']:
                # (Start1 < End2) AND (End1 > Start2)
                if (t1['start'] < t2['end']) and (t1['end'] > t2['start']):
                    return True
    return False

def generate_schedule(courses: List[Dict[str, Any]], selected_ids: List[str], preferences: Dict[str, Any], seed: int = 0) -> List[Dict[str, Any]]:
    model = cp_model.CpModel()
    
    # 1. [전처리] 사용자 선택 과목 확정 (충돌 시 먼저 선택한 것 우선)
    target_ids = selected_ids[:7] if selected_ids else []
    fixed_course_ids = []
    course_map = {c['id']: c for c in courses}

    for cid in target_ids:
        if cid not in course_map: continue
        current_course = course_map[cid]
        is_conflict = False
        
        for fixed_cid in fixed_course_ids:
            if check_time_conflict(current_course, course_map[fixed_cid]):
                is_conflict = True
                break
        
        if not is_conflict:
            fixed_course_ids.append(cid)

    # 2. [모델링] 변수 생성 및 제약 조건 추가
    selected = {} 
    for course in courses:
        selected[course['id']] = model.NewBoolVar(f"course_{course['id']}")

    # 2-1. 확정된 과목은 무조건 포함
    for f_id in fixed_course_ids:
        model.Add(selected[f_id] == 1)

    # 2-2. 전체 수업 개수 최대 7개 제한
    model.Add(sum(selected.values()) <= 7)

    # 2-3. 모든 과목 간 시간 충돌 방지
    for i in range(len(courses)):
        for j in range(i + 1, len(courses)):
            c1 = courses[i]
            c2 = courses[j]
            if check_time_conflict(c1, c2):
                model.Add(selected[c1['id']] + selected[c2['id']] <= 1)

    # 2-4. 학점 범위 제한
    min_c = preferences.get("minCredits", 12)
    max_c = preferences.get("maxCredits", 21)
    
    total_credits = sum(selected[c['id']] * int(c['credits']) for c in courses)
    model.Add(total_credits >= min_c)
    model.Add(total_credits <= max_c)

    # 3. [최적화] 점수 계산 (Objective Function)
    random.seed(seed) 
    lucky_day = seed % 5 

    objective_terms = []
    
    # [새로 추가된 공강 선호 로직에 필요한 변수 정의]
    target_empty_days_str = preferences.get("preferredDays", [])
    target_empty_days_num = [TARGET_DAY_MAP[d] for d in target_empty_days_str if d in TARGET_DAY_MAP]

    for course in courses:
        score = int(course['credits']) * 10
        
        # [변동성 강화] 랜덤 점수 폭을 증가시켜 다양한 Plan 유도
        if course['id'] not in fixed_course_ids:
            score += random.randint(-30, 30)

        # [행운의 요일] Plan마다 특정 요일에 가산점 부여
        for t in course['times']:
            if t['day'] == lucky_day:
                score += 20 

        # [선호도 1: 오전 시간 피하기]
        if preferences.get("avoidMorning"):
            for t in course['times']:
                if t['start'] < 11.0: score -= 50
        
        # [선호도 2: 저녁 시간 피하기]
        if preferences.get("avoidEvening"):
            for t in course['times']:
                if t['end'] > 18.0: score -= 50
                
        # [선호도 3: 짧은 공강 선호 (Compact)]
        if preferences.get("preferLongBreak"):
            is_extreme_time = False
            for t in course['times']:
                # 10시 이전 시작 또는 17시 이후 종료 수업 감점
                if t['start'] < 10.0 or t['end'] > 17.0: 
                    is_extreme_time = True
                    break
            
            if is_extreme_time:
                score -= 80 # 스케줄을 늘어지게 하는 수업에 페널티

        # [선호도 4: 선호 요일 공강 (추가됨)]
        if target_empty_days_num:
            for t in course['times']:
                if t['day'] in target_empty_days_num:
                    score -= 100 # 공강 원하는 요일에 수업 있으면 강력 감점

        objective_terms.append(selected[course['id']] * score)

    model.Maximize(sum(objective_terms))

    # 4. 해결
    solver = cp_model.CpSolver()
    status = solver.Solve(model)

    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        result_plan = []
        for course in courses:
            if solver.Value(selected[course['id']]) == 1:
                result_plan.append(course)
        return result_plan 
    else:
        return []