import subprocess,re,pathlib
workflow=pathlib.Path('.github/workflows/digitalocean-deploy.yml').read_text()
args=re.search(r'run: node --test (.+)',workflow).group(1).split()
with open('tmp/release-tests.log','w',encoding='utf-8') as output:
 result=subprocess.run(['node','--test','--test-reporter=tap',*args],cwd='backend',stdout=output,stderr=subprocess.STDOUT)
print('release_tests_exit_code='+str(result.returncode))
for line in pathlib.Path('tmp/release-tests.log').read_text(encoding='utf-8').splitlines():
 if re.match(r'^(not ok|# tests|# pass|# fail)',line):print(line)
raise SystemExit(result.returncode)
