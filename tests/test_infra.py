"""Lightweight structural checks; does not replace a running Docker/Kubernetes test."""
import unittest
from pathlib import Path
import yaml
ROOT = Path(__file__).resolve().parents[1]

class InfraTests(unittest.TestCase):
    def test_compose_services_and_dependencies(self):
        doc = yaml.safe_load((ROOT / 'compose.yaml').read_text())
        self.assertEqual(set(doc['services']), {'db','backend','frontend'})
        self.assertEqual(doc['services']['backend']['depends_on']['db']['condition'], 'service_healthy')
        self.assertEqual(doc['services']['frontend']['depends_on']['backend']['condition'], 'service_healthy')
        self.assertIn('postgres_data', doc['volumes'])
    def test_nginx_api_proxy(self):
        config = (ROOT / 'frontend/nginx.conf').read_text()
        self.assertIn('location /api/', config)
        self.assertIn('proxy_pass http://backend:8080;', config)
        self.assertIn('try_files $uri $uri/ /index.html;', config)
    def test_kubernetes_resources(self):
        docs = list(yaml.safe_load_all((ROOT / 'k8s/connect4.yaml').read_text()))
        self.assertEqual(len(docs), 9)
        self.assertEqual({d['metadata']['name'] for d in docs if d['kind']=='Deployment'}, {'db','backend','frontend'})
        self.assertEqual({d['metadata']['name'] for d in docs if d['kind']=='Service'}, {'db','backend','frontend'})
        self.assertTrue(any(d['kind']=='PersistentVolumeClaim' for d in docs))
    def test_docker_build_files(self):
        for service in ('backend','frontend'):
            self.assertTrue((ROOT/service/'Dockerfile').is_file())
        self.assertIn('go build', (ROOT/'backend/Dockerfile').read_text())
        self.assertIn('npm run build', (ROOT/'frontend/Dockerfile').read_text())

if __name__ == '__main__': unittest.main()
