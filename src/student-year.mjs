// A manual correction belongs to its class code, so changing class rechecks it.
export function normalizeYear(value) {
  const text=String(value??'').trim();
  if(!/^\d+$/.test(text))return '';
  const year=Number(text);
  return Number.isSafeInteger(year)&&year>0?String(year):'';
}

export function inferYear(klass) {
  return normalizeYear(String(klass??'').match(/\d+/)?.[0]);
}

export function manualYear(student) {
  const override=student.yearOverride;
  return override&&override.class===student.class?normalizeYear(override.year):'';
}

export function setManualYear(student,value) {
  const year=normalizeYear(value);
  if(!year)throw Error('Vul een positief geheel getal als leerjaar in.');
  student.yearOverride={class:student.class,year};
  student.year=year;
}

export function normalizeStudentYears(students) {
  for(const student of students) {
    const manual=manualYear(student);
    if(!manual)delete student.yearOverride;
    student.year=manual||inferYear(student.class);
  }
}

export function studentYearErrors(students) {
  return students.filter(student=>!manualYear(student)&&!inferYear(student.class));
}
